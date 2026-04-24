import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PlatformEvent } from "@s/shared/events";
import {
  type LocalDynamo,
  createFakeTypesenseClient,
  createTable,
  startLocalDynamo,
} from "@s/shared/testing";
import type { EventBridgeEvent } from "aws-lambda";
import type { Building } from "../../core/src/buildings/buildings.entity";

type BuildingIndexerEvent = EventBridgeEvent<
  string,
  PlatformEvent<{ buildingId: string; status?: string }>
>;

/**
 * Integration test for the search-indexer Lambda.
 *
 * Drives the handler through all four upsert-triggering events + the
 * delete event against a real local DynamoDB and a fake in-memory
 * Typesense client. Proves:
 *   - create/update/activated/archived each fetch the row from DDB
 *     and upsert (no fan-out in the Lambda itself — one indexer path)
 *   - delete removes the document directly, no DDB read
 *   - a race where the row is already gone on upsert is silently skipped
 */

const BUILDINGS_TABLE = "Buildings-test";
const STAGE = "dev";
const COLLECTION = `${STAGE}_buildings`;
const TEST_BUILDING_ID = "01HXINDEXER0000000000000000";

let dynamo: LocalDynamo;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;
let handler: typeof import("../../functions/src/search-indexer")["handler"];
let repo: typeof import("../../core/src/buildings/buildings.repository")["buildingsRepository"];

function makeEvent(
  eventName:
    | "building.created"
    | "building.updated"
    | "building.activated"
    | "building.archived"
    | "building.deleted",
  buildingId: string,
): BuildingIndexerEvent {
  return {
    version: "0",
    id: crypto.randomUUID(),
    "detail-type": eventName,
    source: "s-building",
    account: "000000000000",
    time: new Date().toISOString(),
    region: "local",
    resources: [],
    detail: {
      eventName,
      correlationId: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { buildingId },
    },
  };
}

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    buildingId: TEST_BUILDING_ID,
    name: "Karlín Tower",
    description: "Office building",
    address: {
      formatted: "Karlínské nám. 5, Praha",
      streetAddress: "Karlínské nám. 5",
      locality: "Praha",
      region: "Praha",
      postalCode: "186 00",
      countryCode: "CZ",
    },
    areaSqm: 4200,
    population: 350,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "EUR",
    timezone: "Europe/Prague",
    status: "draft",
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z",
    createdAtMs: 1_745_308_800_000,
    updatedAtMs: 1_745_308_800_000,
    ...overrides,
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

  fakeClient = createFakeTypesenseClient({
    collections: {
      [COLLECTION]: [],
    },
  });

  const search = await import("@s/shared/search");
  search.__setClientsForTests({ admin: fakeClient.client });

  // Clear the memoized `ensurePromise` so this test starts against its
  // own fake client — defends against test-order dependencies when the
  // backfill suite runs earlier in the same Bun process.
  const indexerMod = await import("../../core/src/search/buildings.indexer");
  indexerMod.__resetEnsureCacheForTests();

  const mod = await import("../../functions/src/search-indexer");
  handler = mod.handler;

  repo = (await import("../../core/src/buildings/buildings.repository")).buildingsRepository;

  await repo.insert(makeBuilding());
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

describe("search-indexer handler (integration, fake Typesense)", () => {
  test("building.created → upserts the document from DDB", async () => {
    await handler(makeEvent("building.created", TEST_BUILDING_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_BUILDING_ID) as { name?: string; status?: string } | undefined;
    expect(doc?.name).toBe("Karlín Tower");
    expect(doc?.status).toBe("draft");
  });

  test("building.activated re-reads and reflects the new status", async () => {
    await repo.update(TEST_BUILDING_ID, { status: "active" });
    await handler(makeEvent("building.activated", TEST_BUILDING_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_BUILDING_ID) as { status?: string } | undefined;
    expect(doc?.status).toBe("active");
  });

  test("building.archived re-reads and reflects the new status", async () => {
    await repo.update(TEST_BUILDING_ID, { status: "archived" });
    await handler(makeEvent("building.archived", TEST_BUILDING_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_BUILDING_ID) as { status?: string } | undefined;
    expect(doc?.status).toBe("archived");
  });

  test("building.updated re-upserts with current DDB state", async () => {
    await repo.update(TEST_BUILDING_ID, { name: "Karlín Tower II" });
    await handler(makeEvent("building.updated", TEST_BUILDING_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_BUILDING_ID) as { name?: string } | undefined;
    expect(doc?.name).toBe("Karlín Tower II");
  });

  test("building.deleted drops the document", async () => {
    await handler(makeEvent("building.deleted", TEST_BUILDING_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.has(TEST_BUILDING_ID)).toBe(false);
  });

  test("delete is idempotent when the document is already gone", async () => {
    await handler(makeEvent("building.deleted", TEST_BUILDING_ID));
  });

  test("create for an id not in DDB is skipped (race-safe)", async () => {
    const ghost = "01HXGHOST00000000000000000";
    await handler(makeEvent("building.created", ghost));
    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.has(ghost)).toBe(false);
  });
});
