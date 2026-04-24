import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type JwtStub,
  type LocalDynamo,
  createFakeTypesenseClient,
  createStubAuthzView,
  createTable,
  invoke,
  seedAuthzViewEntry,
  startJwtStub,
  startLocalDynamo,
} from "@s/shared/testing";
import type { Permission } from "@s/shared/types";
import type { Hono } from "hono";

/**
 * End-to-end admin route tests. Exercises the full middleware chain
 * (authMiddleware → route handler → service → repo) against local DDB
 * + JWT stub + fake Typesense, proving the scoped-permission matrix
 * lines up with the table in `packages/s-building/CLAUDE.md`.
 */

const BUILDINGS_TABLE = "Buildings-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";
const STAGE = "dev";
const COLLECTION = `${STAGE}_buildings`;

const SUPER_ID = "01HXSUPER00000000000000000A";
const ADMIN_ID = "01HXADMIN00000000000000000A";
const MANAGER_ID = "01HXMANAGER0000000000000000";
const STRANGER_ID = "01HXSTRANGER000000000000000";

const SCOPED_BUILDING = "01HXBUILDINGA00000000000000";
const OTHER_BUILDING = "01HXBUILDINGB00000000000000";

let dynamo: LocalDynamo;
let jwt: JwtStub;
let app: Hono<never, never, "/">;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;

const VALID_BODY = {
  name: "Karlín Tower",
  description: "Office building in Karlín",
  address: {
    formatted: "Karlínské nám. 5, 186 00 Praha 8, Czech Republic",
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
};

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
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, ADMIN_ID, [
    { id: "building_admin", value: [SCOPED_BUILDING] },
  ] as Permission[]);
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, MANAGER_ID, [
    { id: "building_manager", value: [SCOPED_BUILDING] },
  ] as Permission[]);
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, STRANGER_ID, []);

  fakeClient = createFakeTypesenseClient({
    collections: { [COLLECTION]: [] },
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

describe("/building/admin — scoped access matrix", () => {
  test("GET /building/health is public", async () => {
    const res = await invoke(app, "/building/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("admin routes require a bearer token (401 without)", async () => {
    const res = await invoke(app, "/building/admin/buildings");
    expect(res.status).toBe(401);
  });

  test("non-superadmin cannot POST /buildings (403)", async () => {
    const token = await jwt.sign({ sub: ADMIN_ID });
    const res = await invoke(app, "/building/admin/buildings", {
      method: "POST",
      token,
      body: VALID_BODY,
    });
    expect(res.status).toBe(403);
  });

  test("superadmin POST creates a building (201 + Location header + data envelope)", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke<{
      data: { buildingId: string; status: string; name: string };
    }>(app, "/building/admin/buildings", {
      method: "POST",
      token,
      body: VALID_BODY,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("draft");
    expect(res.body.data.name).toBe("Karlín Tower");
    const location = res.headers.get("location");
    expect(location).toBe(`/building/admin/buildings/${res.body.data.buildingId}`);
  });

  test("superadmin POST with status=active creates an active building", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke<{ data: { buildingId: string; status: string } }>(
      app,
      "/building/admin/buildings",
      {
        method: "POST",
        token,
        body: { ...VALID_BODY, status: "active" },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("active");
  });

  test("POST with invalid body returns 400", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke(app, "/building/admin/buildings", {
      method: "POST",
      token,
      body: { ...VALID_BODY, supportedLanguages: [] },
    });
    expect(res.status).toBe(400);
  });

  test("GET /{id} — scoped admin can read their building, not others", async () => {
    // Seed a building directly so we have a deterministic id.
    const { buildingsRepository } = await import("../../core/src/buildings/buildings.repository");
    const row = {
      ...VALID_BODY,
      buildingId: SCOPED_BUILDING,
      status: "draft" as const,
      createdAt: "2026-04-22T08:00:00.000Z",
      updatedAt: "2026-04-22T08:00:00.000Z",
      createdAtMs: 1_745_308_800_000,
      updatedAtMs: 1_745_308_800_000,
    };
    await buildingsRepository.insert(row);
    await buildingsRepository.insert({ ...row, buildingId: OTHER_BUILDING });

    const token = await jwt.sign({ sub: ADMIN_ID });
    const hit = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}`, { token });
    expect(hit.status).toBe(200);

    const miss = await invoke(app, `/building/admin/buildings/${OTHER_BUILDING}`, { token });
    expect(miss.status).toBe(403);
  });

  test("PATCH /{id} — manager can update their scoped building", async () => {
    const token = await jwt.sign({ sub: MANAGER_ID });
    const res = await invoke<{ data: { name: string } }>(
      app,
      `/building/admin/buildings/${SCOPED_BUILDING}`,
      {
        method: "PATCH",
        token,
        body: { name: "Karlín Tower (renamed)" },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Karlín Tower (renamed)");
  });

  test("DELETE — manager is forbidden (only admin/superadmin can delete)", async () => {
    const token = await jwt.sign({ sub: MANAGER_ID });
    const res = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}`, {
      method: "DELETE",
      token,
    });
    expect(res.status).toBe(403);
  });

  test(":archive — manager is forbidden", async () => {
    const token = await jwt.sign({ sub: MANAGER_ID });
    const res = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}:archive`, {
      method: "POST",
      token,
    });
    expect(res.status).toBe(403);
  });

  test(":activate then :archive — scoped admin completes the lifecycle", async () => {
    const token = await jwt.sign({ sub: ADMIN_ID });
    const activated = await invoke<{ data: { status: string } }>(
      app,
      `/building/admin/buildings/${SCOPED_BUILDING}:activate`,
      { method: "POST", token },
    );
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("active");

    const archived = await invoke<{ data: { status: string } }>(
      app,
      `/building/admin/buildings/${SCOPED_BUILDING}:archive`,
      { method: "POST", token },
    );
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("archived");
  });

  test("GET /{id} on a missing building returns 404", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke(app, "/building/admin/buildings/01HXDOESNOTEXIST0000000000", {
      token,
    });
    expect(res.status).toBe(404);
  });

  test("DELETE — scoped admin can delete; row is gone afterwards", async () => {
    const token = await jwt.sign({ sub: ADMIN_ID });
    const del = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}`, {
      method: "DELETE",
      token,
    });
    expect(del.status).toBe(204);

    const supToken = await jwt.sign({ sub: SUPER_ID });
    const miss = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}`, {
      token: supToken,
    });
    expect(miss.status).toBe(404);
  });
});

describe("/building/admin/buildings list — scope filter", () => {
  test("superadmin list returns every building (no scope filter)", async () => {
    // Seed two buildings in Typesense directly via the fake — simulates
    // the indexer having already processed upstream events.
    const col = fakeClient.state.collections.get(COLLECTION);
    col?.docs.clear();
    for (const id of [SCOPED_BUILDING, OTHER_BUILDING]) {
      col?.docs.set(id, {
        id,
        name: `Building ${id.slice(-4)}`,
        status: "draft",
        countryCode: "CZ",
        locality: "Praha",
        createdAtMs: 1,
        updatedAtMs: 1,
        areaSqm: 1000,
        population: 10,
      });
    }

    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke<{ data: Array<{ id: string }>; meta: { found: number } }>(
      app,
      "/building/admin/buildings",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.found).toBe(2);
  });

  test("scoped admin list only sees their building", async () => {
    const token = await jwt.sign({ sub: ADMIN_ID });
    const res = await invoke<{ data: Array<{ id: string }> }>(app, "/building/admin/buildings", {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => d.id)).toEqual([SCOPED_BUILDING]);
  });

  test("caller with no building permissions gets a 200 with empty data (no 403)", async () => {
    const token = await jwt.sign({ sub: STRANGER_ID });
    const res = await invoke<{ data: unknown[]; meta: { found: number } }>(
      app,
      "/building/admin/buildings",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.found).toBe(0);
  });

  test("scoped caller supplying `(` or `||` in filter_by → 400 (scope-escape guard)", async () => {
    const token = await jwt.sign({ sub: ADMIN_ID });
    const res = await invoke(
      app,
      `/building/admin/buildings?filter_by=${encodeURIComponent("id:=[foo]) || (status:=active")}`,
      { token },
    );
    expect(res.status).toBe(400);
  });

  test("per_page > 100 is rejected by the schema (400)", async () => {
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke(app, "/building/admin/buildings?per_page=250", { token });
    expect(res.status).toBe(400);
  });
});

describe("/_actions/ internal path is not publicly routable", () => {
  test("direct POST to /_actions/archive returns 404", async () => {
    // The :verb rewrite is the only supported ingress. A caller who
    // tries to address the internal path directly should not reach the
    // handler — this test pins that guarantee.
    const token = await jwt.sign({ sub: SUPER_ID });
    const res = await invoke(app, `/building/admin/buildings/${SCOPED_BUILDING}/_actions/archive`, {
      method: "POST",
      token,
    });
    expect(res.status).toBe(404);
  });
});
