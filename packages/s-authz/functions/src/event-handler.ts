import {
  clearViewForUser,
  initViewForUser,
  rebuildViewForUser,
} from "@s-authz/core/view/view.service";
import type { PlatformEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { EventBridgeEvent } from "aws-lambda";

type AnyPayload = {
  userId?: string;
};

/**
 * EventBridge handler. Reacts to user- and group-lifecycle events to keep
 * the AuthzView in sync.
 *
 * All handlers are idempotent (the service layer overwrites the row).
 */
export async function handler(
  event: EventBridgeEvent<string, PlatformEvent<AnyPayload>>,
): Promise<void> {
  const envelope = event.detail;
  const payload = envelope.payload;
  if (!payload.userId) {
    logger.debug("Event without userId — ignoring", { eventName: envelope.eventName });
    return;
  }

  logger.info("📨 Event received", {
    eventName: envelope.eventName,
    correlationId: envelope.correlationId,
    userId: payload.userId,
  });

  try {
    switch (envelope.eventName) {
      case "user.registered":
        await initViewForUser(payload.userId);
        break;

      case "user.enabled":
      case "group.user.activated":
      case "group.user.deactivated":
        await rebuildViewForUser(payload.userId);
        break;

      case "user.disabled":
        await clearViewForUser(payload.userId);
        break;

      default:
        logger.debug("Unhandled event", { eventName: envelope.eventName });
    }
  } catch (err) {
    logger.error("❌ Authz event handler failed", {
      eventName: envelope.eventName,
      correlationId: envelope.correlationId,
      message: (err as Error).message,
    });
    throw err;
  }
}
