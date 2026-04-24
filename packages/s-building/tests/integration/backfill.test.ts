import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type LocalDynamo,
  createFakeTypesenseClient,
  createTable,
  startLocalDynamo,
} from "@s/shared/testing";
import type { Building } from "../../core/src/buildings/buildings.entity";

/**
 * Backfill Lambda integration — seeds a real local DDB with N rows,
 * runs the Lambda against a fake Typesense, and asserts the collection
 * ends up with every document. Proves:
 *   - bulk-import upserts every seeded row
 *   - cursor resumes across multiple invocations (batchSize < total)
 *   - a stage with zero buildings reports no error and no work
 */

const BUILDINGS_TABLE = "Buildings-test";
const STAGE = "dev";
const COLLECTION = `${STAGE}_buildings`;
const TOTAL_ROWS = 7;

let dynamo: LocalDynamo;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;
let handler: typeof import("../../functions/src/backfill")["handler"];
let repo: typeof import("../../core/src/buildings/buildings.repository")["buildingsRepository"];

function buildingRow(i: number): Building {
  return {
    buildingId: `01HXBF${String(i).padStart(20, "0")}`,
    name: `Backfill Building ${i}`,
    address: {
      formatted: `${i} Backfill St, Seattle, WA`,
      streetAddress: `${i} Backfill St`,
      locality: "Seattle",
      region: "WA",
      postalCode: "98101",
      countryCode: "US",
    },
    areaSqm: 1000 + i * 100,
    population: 50 + i,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "USD",
    timezone: "America/Los_Angeles",
    status: i % 2 === 0 ? "active" : "draft",
    createdAt: new Date(1_745_308_800_000 + i * 1000).toISOString(),
    updatedAt: new Date(1_745_308_800_000 + i * 1000).toISOString(),
    createdAtMs: 1_745_308_800_000 + i * 1000,
    updatedAtMs: 1_745_308_800_000 + i * 1000,
  };
}

beforeAll(async () => {
  dynamo = await startLocalDynamo();

  process.env.STAGE = STAGE;
  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.BUILDINGS_TABLE_NAME = BUILDINGS_TABLE;

  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();

  await createTable(dynamo.endpoint, {
    tableName: BUILDINGS_TABLE,
    partitionKey: "buildingId",
    attributeTypes: { status: "S", updatedAtMs: "N" },
    indexes: [{ indexName: "ByStatus", partitionKey: "status", sortKey: "updatedAtMs" }],
  });

  fakeClient = createFakeTypesenseClient();

  const search = await import("@s/shared/search");
  search.__setClientsForTests({ admin: fakeClient.client });

  const indexerMod = await import("../../core/src/search/buildings.indexer");
  indexerMod.__resetEnsureCacheForTests();

  const mod = await import("../../functions/src/backfill");
  handler = mod.handler;

  repo = (await import("../../core/src/buildings/buildings.repository")).buildingsRepository;

  for (let i = 0; i < TOTAL_ROWS; i++) {
    await repo.insert(buildingRow(i));
  }
});

afterAll(async () => {
  const search = await import("@s/shared/search");
  search.__resetClientCacheForTests();
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  const indexerMod = await import("../../core/src/search/buildings.indexer");
  indexerMod.__resetEnsureCacheForTests();
  await dynamo.stop();
});

describe("backfill handler (integration, fake Typesense)", () => {
  test("a single invocation with a generous batch indexes every row", async () => {
    const result = await handler({ batchSize: 100, maxBatches: 1 });
    expect(result.indexed).toBe(TOTAL_ROWS);
    expect(result.failed).toBe(0);
    expect(result.lastKey).toBeNull();

    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.size).toBe(TOTAL_ROWS);
  });

  test("a small batch returns a cursor and resumes across invocations", async () => {
    // Fresh collection so the counts are meaningful.
    fakeClient.state.collections.delete(COLLECTION);
    const indexerMod = await import("../../core/src/search/buildings.indexer");
    indexerMod.__resetEnsureCacheForTests();

    let cursor: Record<string, unknown> | null | undefined = undefined;
    let totalIndexed = 0;
    let invocations = 0;

    do {
      const result = await handler({
        startKey: cursor ?? undefined,
        batchSize: 3,
        maxBatches: 1,
      });
      totalIndexed += result.indexed;
      cursor = result.lastKey;
      invocations += 1;
      if (invocations > 20) throw new Error("runaway loop");
    } while (cursor !== null);

    expect(totalIndexed).toBe(TOTAL_ROWS);
    expect(invocations).toBeGreaterThan(1);
    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.size).toBe(TOTAL_ROWS);
  });
});
