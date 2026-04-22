import { logger } from "@s/shared/logger";
import { adminClient, resolveCollectionName } from "@s/shared/search";
import type { UserProfile } from "../profiles/profiles.entity";
import {
  USERS_ENTITY,
  type UserSearchDocument,
  profileToSearchDocument,
  usersCollectionSchema,
} from "./users.collection";

/**
 * Write-side search operations for the users collection.
 *
 * Called from:
 *   - the indexer Lambda (EventBridge subscriber)
 *   - the backfill script (one-shot seed from DDB)
 *
 * Both paths use the admin client (scoped `<stage>_*`). Collection is
 * ensured lazily on first write — the bootstrap runbook handles it
 * up-front but this keeps personal stages self-healing on first use.
 */

function usersCollection(): string {
  return resolveCollectionName(USERS_ENTITY);
}

let ensurePromise: Promise<void> | undefined;

export async function ensureUsersCollection(): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const name = usersCollection();
    const client = await adminClient();
    try {
      await client.collections(name).retrieve();
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    logger.info("Creating Typesense users collection", { collection: name });
    await client.collections().create(usersCollectionSchema(name));
  })();

  try {
    await ensurePromise;
  } catch (err) {
    ensurePromise = undefined;
    throw err;
  }
}

export async function indexUserProfile(profile: UserProfile): Promise<void> {
  await ensureUsersCollection();
  const doc = profileToSearchDocument(profile);
  const client = await adminClient();
  await client.collections<UserSearchDocument>(usersCollection()).documents().upsert(doc);
  logger.info("Indexed user profile", { userId: profile.userId });
}

export async function deleteUserFromIndex(userId: string): Promise<void> {
  const client = await adminClient();
  try {
    await client.collections(usersCollection()).documents(userId).delete();
    logger.info("Removed user from search index", { userId });
  } catch (err) {
    if (isNotFound(err)) {
      // Already gone — idempotent.
      return;
    }
    throw err;
  }
}

export async function bulkIndexUserProfiles(
  profiles: Iterable<UserProfile>,
): Promise<{ indexed: number; failed: number }> {
  await ensureUsersCollection();
  const docs = [...profiles].map(profileToSearchDocument);
  if (docs.length === 0) return { indexed: 0, failed: 0 };
  const client = await adminClient();
  const results = await client
    .collections<UserSearchDocument>(usersCollection())
    .documents()
    .import(docs, { action: "upsert" });
  const failed = results.filter((r) => !r.success).length;
  return { indexed: docs.length - failed, failed };
}

/**
 * Typesense throws a 404 with `ObjectNotFound` for missing records.
 * We pattern-match loosely to survive across SDK versions.
 */
function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { httpStatus?: number; name?: string };
  return anyErr.httpStatus === 404 || anyErr.name === "ObjectNotFound";
}

/** Test hook — reset the memoized collection-ensure promise. */
export function __resetEnsureCacheForTests(): void {
  ensurePromise = undefined;
}
