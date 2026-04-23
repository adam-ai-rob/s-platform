import { logger } from "@s/shared/logger";
import { adminClient, resolveCollectionName } from "@s/shared/search";
import type { Building } from "../buildings/buildings.entity";
import {
  BUILDINGS_ENTITY,
  type BuildingSearchDocument,
  buildingToSearchDocument,
  buildingsCollectionSchema,
} from "./buildings.collection";

/**
 * Write-side search operations for the buildings collection.
 *
 * Called from:
 *   - the indexer Lambda (EventBridge subscriber)
 *   - the backfill Lambda (one-shot seed from DDB)
 *
 * Both paths use the admin client (scoped `<stage>_*`). Collection is
 * ensured lazily on first write — the bootstrap runbook creates it
 * up-front; this keeps personal stages self-healing.
 */

function buildingsCollection(): string {
  return resolveCollectionName(BUILDINGS_ENTITY);
}

let ensurePromise: Promise<void> | undefined;

export async function ensureBuildingsCollection(): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const name = buildingsCollection();
    const client = await adminClient();
    try {
      await client.collections(name).retrieve();
      return;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    logger.info("Creating Typesense buildings collection", { collection: name });
    await client.collections().create(buildingsCollectionSchema(name));
  })();

  try {
    await ensurePromise;
  } catch (err) {
    ensurePromise = undefined;
    throw err;
  }
}

export async function indexBuilding(building: Building): Promise<void> {
  await ensureBuildingsCollection();
  const doc = buildingToSearchDocument(building);
  const client = await adminClient();
  await client.collections<BuildingSearchDocument>(buildingsCollection()).documents().upsert(doc);
  logger.info("Indexed building", { buildingId: building.buildingId, status: building.status });
}

export async function deleteBuildingFromIndex(buildingId: string): Promise<void> {
  const client = await adminClient();
  try {
    await client.collections(buildingsCollection()).documents(buildingId).delete();
    logger.info("Removed building from search index", { buildingId });
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}

export async function bulkIndexBuildings(
  buildings: Iterable<Building>,
): Promise<{ indexed: number; failed: number }> {
  await ensureBuildingsCollection();
  const docs = [...buildings].map(buildingToSearchDocument);
  if (docs.length === 0) return { indexed: 0, failed: 0 };
  const client = await adminClient();
  const results = await client
    .collections<BuildingSearchDocument>(buildingsCollection())
    .documents()
    .import(docs, { action: "upsert" });
  const failed = results.filter((r) => !r.success).length;
  return { indexed: docs.length - failed, failed };
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { httpStatus?: number; name?: string };
  return anyErr.httpStatus === 404 || anyErr.name === "ObjectNotFound";
}

/** Test hook — reset the memoized collection-ensure promise. */
export function __resetEnsureCacheForTests(): void {
  ensurePromise = undefined;
}
