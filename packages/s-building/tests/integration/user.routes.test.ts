import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type JwtStub,
  type LocalDynamo,
  createStubAuthzView,
  createTable,
  invoke,
  seedAuthzViewEntry,
  startJwtStub,
  startLocalDynamo,
} from "@s/shared/testing";
import type { Permission } from "@s/shared/types";
import type { Hono } from "hono";
import { createFakeTypesenseClient } from "./fake-typesense";

/**
 * Consumer audience. Two rules the test suite pins down:
 *
 *   1. Only ACTIVE buildings are visible. Drafts and archived rows
 *      never surface on this audience, even for superadmin.
 *   2. Hidden resources 404, never 403. A caller asking for a
 *      building they can't see must not be able to distinguish "does
 *      not exist" from "you don't have access".
 */

const BUILDINGS_TABLE = "Buildings-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";
const STAGE = "dev";
const COLLECTION = `${STAGE}_buildings`;

const SUPER_ID = "01HXSUPER00000000000000000A";
const USER_ID = "01HXUSER000000000000000000A";
const STRANGER_ID = "01HXSTRANGER000000000000000";

const ACTIVE_BUILDING = "01HXACTIVE0000000000000000A";
const DRAFT_BUILDING = "01HXDRAFT00000000000000000A";
const ARCHIVED_BUILDING = "01HXARCHIVED00000000000000A";
const OUT_OF_SCOPE_ACTIVE = "01HXOOS000000000000000000A";

let dynamo: LocalDynamo;
let jwt: JwtStub;
let app: Hono<never, never, "/">;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;

function baseBuilding(overrides: Record<string, unknown>) {
  return {
    name: "Test Building",
    description: "Integration fixture",
    address: {
      formatted: "1 Test St, Seattle, WA",
      streetAddress: "1 Test St",
      locality: "Seattle",
      region: "WA",
      postalCode: "98101",
      countryCode: "US",
    },
    areaSqm: 1000,
    population: 50,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "USD",
    timezone: "America/Los_Angeles",
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z",
    createdAtMs: 1_745_308_800_000,
    updatedAtMs: 1_745_308_800_000,
    ...overrides,
  };
}

function searchDoc(id: string, status: "draft" | "active" | "archived") {
  return {
    id,
    name: `Building ${id.slice(-4)}`,
    status,
    countryCode: "US",
    locality: "Seattle",
    region: "WA",
    createdAtMs: 1_745_308_800_000,
    updatedAtMs: 1_745_308_800_000,
    areaSqm: 1000,
    population: 50,
  };
}

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  const auth = await import("@s/shared/auth");
  auth.__resetJwksForTests();

  process.env.STAGE = STAGE;
  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.BUILDINGS_TABLE_NAME = BUILDINGS_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";
  process.env.EVENT_BUS_NAME = "platform-events-test";

  await createTable(dynamo.endpoint, {
    tableName: BUILDINGS_TABLE,
    partitionKey: "buildingId",
    attributeTypes: { status: "S", updatedAtMs: "N" },
    indexes: [{ indexName: "ByStatus", partitionKey: "status", sortKey: "updatedAtMs" }],
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);

  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, SUPER_ID, [
    { id: "building_superadmin" },
  ] as Permission[]);
  // User has scope over: active (visible), draft (should 404), archived (should 404).
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, USER_ID, [
    { id: "building_user", value: [ACTIVE_BUILDING, DRAFT_BUILDING, ARCHIVED_BUILDING] },
  ] as Permission[]);
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, STRANGER_ID, []);

  // Seed DDB so GET /buildings/{id} has real rows to return.
  const { buildingsRepository } = await import("../../core/src/buildings/buildings.repository");
  await buildingsRepository.insert(
    baseBuilding({
      buildingId: ACTIVE_BUILDING,
      status: "active",
    }) as Parameters<typeof buildingsRepository.insert>[0],
  );
  await buildingsRepository.insert(
    baseBuilding({
      buildingId: DRAFT_BUILDING,
      status: "draft",
    }) as Parameters<typeof buildingsRepository.insert>[0],
  );
  await buildingsRepository.insert(
    baseBuilding({
      buildingId: ARCHIVED_BUILDING,
      status: "archived",
    }) as Parameters<typeof buildingsRepository.insert>[0],
  );
  await buildingsRepository.insert(
    baseBuilding({
      buildingId: OUT_OF_SCOPE_ACTIVE,
      status: "active",
    }) as Parameters<typeof buildingsRepository.insert>[0],
  );

  // Seed Typesense fake — mirrors what the indexer would have written.
  fakeClient = createFakeTypesenseClient({
    collections: {
      [COLLECTION]: [
        searchDoc(ACTIVE_BUILDING, "active"),
        searchDoc(DRAFT_BUILDING, "draft"),
        searchDoc(ARCHIVED_BUILDING, "archived"),
        searchDoc(OUT_OF_SCOPE_ACTIVE, "active"),
      ],
    },
  });
  const search = await import("@s/shared/search");
  search.__setClientsForTests({ admin: fakeClient.client, search: fakeClient.client });
  const events = await import("@s/shared/events");
  events.__setEventBridgeClientForTests({
    send: async () => ({ FailedEntryCount: 0, Entries: [] }),
  } as unknown as Parameters<typeof events.__setEventBridgeClientForTests>[0]);
  const indexerMod = await import("../../core/src/search/buildings.indexer");
  indexerMod.__resetEnsureCacheForTests();

  const api = await import("../../functions/src/api");
  app = api.default as unknown as Hono<never, never, "/">;
});

afterAll(async () => {
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  const search = await import("@s/shared/search");
  search.__resetClientCacheForTests();
  const events = await import("@s/shared/events");
  events.__resetEventBridgeClientForTests();
  const indexerMod = await import("../../core/src/search/buildings.indexer");
  indexerMod.__resetEnsureCacheForTests();
  await jwt.stop();
  await dynamo.stop();
});

describe("GET /building/user/buildings", () => {
  test("unauthenticated → 401", async () => {
    const res = await invoke(app, "/building/user/buildings");
    expect(res.status).toBe(401);
  });

  test("superadmin sees every ACTIVE building (no drafts, no archived)", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke<{ data: Array<{ id: string; status: string }> }>(
      app,
      "/building/user/buildings",
      { token },
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d) => d.id).sort();
    expect(ids).toEqual([ACTIVE_BUILDING, OUT_OF_SCOPE_ACTIVE].sort());
    for (const b of res.body.data) expect(b.status).toBe("active");
  });

  test("scoped user sees only ACTIVE buildings within their scope", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke<{ data: Array<{ id: string; status: string }> }>(
      app,
      "/building/user/buildings",
      { token },
    );
    expect(res.status).toBe(200);
    // User's scope covers ACTIVE + DRAFT + ARCHIVED ids, but only ACTIVE
    // should make it past the `status:=active` filter.
    expect(res.body.data.map((d) => d.id)).toEqual([ACTIVE_BUILDING]);
  });

  test("caller with empty scope → 200 with empty data (no 403)", async () => {
    const token = await jwt.sign({ sub: STRANGER_ID });
    const res = await invoke<{ data: unknown[]; meta: { found: number } }>(
      app,
      "/building/user/buildings",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.found).toBe(0);
  });

  test("scoped caller passing `(` / `||` in filter_by → 400 (scope-escape guard)", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke(
      app,
      `/building/user/buildings?filter_by=${encodeURIComponent("status:=active) || (id:=[bogus]")}`,
      { token },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /building/user/buildings/{id}", () => {
  test("unauthenticated → 401", async () => {
    const res = await invoke(app, `/building/user/buildings/${ACTIVE_BUILDING}`);
    expect(res.status).toBe(401);
  });

  test("scoped user sees their ACTIVE building (200)", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke<{ data: { buildingId: string; status: string } }>(
      app,
      `/building/user/buildings/${ACTIVE_BUILDING}`,
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.buildingId).toBe(ACTIVE_BUILDING);
    expect(res.body.data.status).toBe("active");
  });

  test("scoped user asking for a DRAFT row in their scope → 404 (status hides it)", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke(app, `/building/user/buildings/${DRAFT_BUILDING}`, { token });
    expect(res.status).toBe(404);
  });

  test("scoped user asking for an ARCHIVED row in their scope → 404", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke(app, `/building/user/buildings/${ARCHIVED_BUILDING}`, { token });
    expect(res.status).toBe(404);
  });

  test("out-of-scope ACTIVE row → 404 (existence not leaked)", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke(app, `/building/user/buildings/${OUT_OF_SCOPE_ACTIVE}`, { token });
    expect(res.status).toBe(404);
  });

  test("stranger (no building_user permission) → 404 on any id", async () => {
    const token = await jwt.sign({ sub: STRANGER_ID });
    const res = await invoke(app, `/building/user/buildings/${ACTIVE_BUILDING}`, { token });
    expect(res.status).toBe(404);
  });

  test("non-existent id → 404", async () => {
    const token = await jwt.sign({ sub: USER_ID });
    const res = await invoke(app, "/building/user/buildings/01HXDOESNOTEXIST0000000000", {
      token,
    });
    expect(res.status).toBe(404);
  });

  test("superadmin can read an ACTIVE building they don't have explicit scope on (200)", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke<{ data: { buildingId: string } }>(
      app,
      `/building/user/buildings/${OUT_OF_SCOPE_ACTIVE}`,
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.buildingId).toBe(OUT_OF_SCOPE_ACTIVE);
  });

  test("superadmin asking for a DRAFT building → 404 (user audience rule applies to everyone)", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke(app, `/building/user/buildings/${DRAFT_BUILDING}`, { token });
    expect(res.status).toBe(404);
  });
});
