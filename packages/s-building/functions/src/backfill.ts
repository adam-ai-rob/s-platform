import { buildingsRepository } from "@s-building/core/buildings/buildings.repository";
import {
  bulkIndexBuildings,
  ensureBuildingsCollection,
} from "@s-building/core/search/buildings.indexer";
import { logger } from "@s/shared/logger";

/**
 * Backfill Lambda — seeds (or reseeds) the Typesense `buildings`
 * collection from the DynamoDB Buildings table.
 *
 * Idempotent (every row is `upsert`ed) and resumable (pagination cursor).
 *
 * Invocation contract:
 *   {
 *     "startKey": { "buildingId": "…" } | undefined,
 *     "batchSize": 500,     // ≤ 1000 recommended
 *     "maxBatches": 1       // safety cap per invocation
 *   }
 *
 * Returns:
 *   {
 *     "indexed": 1234,
 *     "failed": 0,
 *     "batchesRun": 1,
 *     "lastKey": { "buildingId": "…" } | null
 *   }
 *
 * Call repeatedly with the returned `lastKey` until it's null. The
 * runbook (`docs/runbooks/typesense-stage-bootstrap.md`) walks through
 * the operator flow.
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

  await ensureBuildingsCollection();

  let indexed = 0;
  let failed = 0;
  let batchesRun = 0;
  let cursor: Record<string, unknown> | undefined = input.startKey;

  while (batchesRun < maxBatches) {
    const page = await buildingsRepository.scanPage(cursor, batchSize);
    if (page.items.length === 0 && !page.lastKey) {
      cursor = undefined;
      break;
    }

    const { indexed: batchIndexed, failed: batchFailed } = await bulkIndexBuildings(page.items);
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
