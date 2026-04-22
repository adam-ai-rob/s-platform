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
import { createFakeTypesenseClient } from "./fake-typesense";

/**
 * End-to-end integration test for the Typesense-backed search path —
 * runs locally without AWS or a real Typesense cluster. Exercises the
 * full Hono → service → client chain with a mocked Typesense so that CI
 * can prove the wiring is correct on every PR, not just the ones that
 * carry the `deployed-test` label.
 *
 * Seeds the `dev_users` collection in the fake (matches the stage name
 * set via STAGE=dev below), invokes `/user/search`, and asserts the
 * response envelope + behaviour of the validation + pagination paths.
 */

// Keep table + endpoint state consistent across all integration test
// files: the s-user repository singleton is created at first import and
// captures the table name; later files that try different names would
// see stale config.
const USER_PROFILES_TABLE = "UserProfiles-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";
const TEST_USER_ID = "01HXTESTUSER000000000000000";
const STAGE = "dev";
const COLLECTION = `${STAGE}_users`;

let dynamo: LocalDynamo;
let jwt: JwtStub;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported Hono app
let app: any;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  process.env.STAGE = STAGE;
  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.USER_PROFILES_TABLE_NAME = USER_PROFILES_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";

  // Bun runs every file in the same process, so singleton caches (DDB
  // client, search client, repository, JWKS set) bleed across files.
  // Reset them before any dynamic imports pick them up.
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  const auth = await import("@s/shared/auth");
  auth.__resetJwksForTests();

  await createTable(dynamo.endpoint, {
    tableName: USER_PROFILES_TABLE,
    partitionKey: "userId",
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, TEST_USER_ID, []);

  // Seed the fake Typesense cluster with three user docs so we can
  // exercise search, filtering, and pagination.
  fakeClient = createFakeTypesenseClient({
    collections: {
      [COLLECTION]: [
        {
          id: "u_ada",
          firstName: "Ada",
          lastName: "Lovelace",
          displayName: "Ada Lovelace",
          avatarUrl: "",
          createdAtMs: 1_700_000_000_000,
          updatedAtMs: 1_700_000_000_000,
        },
        {
          id: "u_grace",
          firstName: "Grace",
          lastName: "Hopper",
          displayName: "Grace Hopper",
          avatarUrl: "",
          createdAtMs: 1_710_000_000_000,
          updatedAtMs: 1_710_000_000_000,
        },
        {
          id: "u_alan",
          firstName: "Alan",
          lastName: "Turing",
          displayName: "Alan Turing",
          avatarUrl: "",
          createdAtMs: 1_690_000_000_000,
          updatedAtMs: 1_690_000_000_000,
        },
      ],
    },
  });

  // Dynamic imports AFTER env + mocks are set up.
  const api = await import("@s-user/functions/api");
  app = api.default;

  const search = await import("@s/shared/search");
  search.__setClientsForTests({ search: fakeClient.client, admin: fakeClient.client });
});

afterAll(async () => {
  const search = await import("@s/shared/search");
  search.__resetClientCacheForTests();
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  await jwt.stop();
  await dynamo.stop();
});

describe("GET /user/search (integration, fake Typesense)", () => {
  test("returns all seeded users with default params", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{
      hits: Array<{ id: string; firstName: string }>;
      found: number;
      page: number;
      per_page: number;
    }>(app, "/user/search", { token });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.per_page).toBe(20);
    expect(res.body.hits).toHaveLength(3);
    expect(res.body.hits.map((h) => h.firstName).sort()).toEqual(["Ada", "Alan", "Grace"]);
  });

  test("full-text search narrows by name", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{
      hits: Array<{ id: string }>;
      found: number;
    }>(app, "/user/search?q=grace", { token });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(1);
    expect(res.body.hits[0]?.id).toBe("u_grace");
  });

  test("clamps per_page ≤ 100 even when client asks for more", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{ per_page: number }>(app, "/user/search?per_page=500", {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.body.per_page).toBe(100);
  });

  test("paginates via page + per_page", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const page1 = await invoke<{
      hits: unknown[];
      found: number;
      page: number;
      next_cursor?: string;
    }>(app, "/user/search?per_page=2&page=1", { token });
    const page2 = await invoke<{
      hits: unknown[];
      found: number;
      page: number;
    }>(app, "/user/search?per_page=2&page=2", { token });

    expect(page1.body.found).toBe(3);
    expect(page1.body.hits).toHaveLength(2);
    expect(page1.body.next_cursor).toBeDefined();
    expect(page2.body.hits).toHaveLength(1);
  });

  test("401 when called unauthenticated", async () => {
    const res = await invoke(app, "/user/search");
    expect(res.status).toBe(401);
  });

  test("400 when sort_by references a non-whitelisted field", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke(app, "/user/search?sort_by=ssn:desc", { token });
    expect(res.status).toBe(400);
  });

  test("accepts sort_by without id tiebreaker", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke(app, "/user/search?sort_by=createdAtMs:desc", { token });
    expect(res.status).toBe(200);
  });

  test("400 when filter_by references a non-whitelisted field", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke(app, "/user/search?filter_by=ssn:%3D1234", { token });
    expect(res.status).toBe(400);
  });
});
