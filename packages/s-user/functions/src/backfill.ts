import { userProfilesRepository } from "@s-user/core/profiles/profiles.repository";
import { bulkIndexUserProfiles, ensureUsersCollection } from "@s-user/core/search/users.indexer";
import { logger } from "@s/shared/logger";

/**
 * Backfill Lambda — seeds (or reseeds) the Typesense `users` collection
 * from the DynamoDB UserProfiles table.
 *
 * Idempotent (every row is `upsert`ed) and resumable (pagination cursor).
 *
 * Invocation contract:
 *   {
 *     "startKey": { "userId": "…" } | undefined,  // DDB LastEvaluatedKey
 *     "batchSize": 500,                           // ≤ 1000 recommended
 *     "maxBatches": 1                             // safety cap per invocation
 *   }
 *
 * Returns:
 *   {
 *     "indexed": 1234,
 *     "failed": 0,
 *     "batchesRun": 1,
 *     "lastKey": { "userId": "…" } | null         // null when done
 *   }
 *
 * Call repeatedly with the returned `lastKey` until it's null. The
 * runbook (`docs/runbooks/typesense-stage-bootstrap.md`) shows the
 * operator flow.
 */

interface BackfillInput {
  startKey?: Record<string, unknown>;
  batchSize?: number;
  maxBatches?: number;
}

interface BackfillResult {
  indexed: number;
  failed: number;
  batchesRun: number;
  lastKey: Record<string, unknown> | null;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 1;

export async function handler(input: BackfillInput = {}): Promise<BackfillResult> {
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = input.maxBatches ?? DEFAULT_MAX_BATCHES;

  await ensureUsersCollection();

  let indexed = 0;
  let failed = 0;
  let batchesRun = 0;
  let cursor: Record<string, unknown> | undefined = input.startKey;

  while (batchesRun < maxBatches) {
    const page = await userProfilesRepository.scanPage(cursor, batchSize);
    if (page.items.length === 0 && !page.lastKey) {
      cursor = undefined;
      break;
    }

    const { indexed: batchIndexed, failed: batchFailed } = await bulkIndexUserProfiles(page.items);
    indexed += batchIndexed;
    failed += batchFailed;
    batchesRun += 1;

    logger.info("Backfill batch complete", {
      batchesRun,
      batchIndexed,
      batchFailed,
      hasMore: Boolean(page.lastKey),
    });

    cursor = page.lastKey;
    if (!cursor) break;
  }

  return {
    indexed,
    failed,
    batchesRun,
    lastKey: cursor ?? null,
  };
}
