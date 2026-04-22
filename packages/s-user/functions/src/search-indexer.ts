import { userProfilesRepository } from "@s-user/core/profiles/profiles.repository";
import { deleteUserFromIndex, indexUserProfile } from "@s-user/core/search/users.indexer";
import type { PlatformEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { EventBridgeEvent } from "aws-lambda";

/**
 * EventBridge subscriber that keeps the Typesense `users` collection in
 * sync with DDB UserProfiles.
 *
 * Listens for:
 *   - user.profile.created → read full profile from DDB, upsert
 *   - user.profile.updated → read full profile from DDB, upsert
 *   - user.profile.deleted → delete document by userId
 *
 * Events only carry the identity + names; the full profile (avatarUrl,
 * createdAt, updatedAt) is fetched from DDB because it's the source of
 * truth. That costs one GetItem per event but gives us two free
 * correctness properties:
 *
 *   1. **Out-of-order events are safe.** If EventBridge redelivers a
 *      stale `updated` event after a newer `updated` has already been
 *      processed, we still re-read from DDB and re-upsert the CURRENT
 *      state — the index can't regress below what's persisted. No
 *      `updatedAtMs` compare-and-set needed.
 *
 *   2. **Race against concurrent delete is safe.** If a `delete` lands
 *      between the event being published and the upsert running, the
 *      DDB read returns `undefined` and we skip silently; the delete
 *      tombstone event will arrive shortly after and clean the index.
 *
 * Throws on failure — Lambda retries, then DLQ (wired in infra).
 */

interface UserProfileEventPayload {
  userId: string;
  firstName?: string;
  lastName?: string;
}

type SupportedEvent = "user.profile.created" | "user.profile.updated" | "user.profile.deleted";

export async function handler(
  event: EventBridgeEvent<string, PlatformEvent<UserProfileEventPayload>>,
): Promise<void> {
  const envelope = event.detail;
  logger.info("📨 Indexer event received", {
    eventName: envelope.eventName,
    correlationId: envelope.correlationId,
  });

  try {
    switch (envelope.eventName as SupportedEvent) {
      case "user.profile.created":
      case "user.profile.updated": {
        const profile = await userProfilesRepository.findById(envelope.payload.userId);
        if (!profile) {
          // Raced with a delete — the tombstone event will arrive; skip.
          logger.info("Profile not found on index upsert; skipping", {
            userId: envelope.payload.userId,
          });
          return;
        }
        await indexUserProfile(profile);
        break;
      }
      case "user.profile.deleted":
        await deleteUserFromIndex(envelope.payload.userId);
        break;
      default:
        logger.debug("Unhandled event in indexer", { eventName: envelope.eventName });
    }
  } catch (err) {
    logger.error("❌ Indexer failed", {
      eventName: envelope.eventName,
      correlationId: envelope.correlationId,
      message: (err as Error).message,
    });
    throw err;
  }
}
