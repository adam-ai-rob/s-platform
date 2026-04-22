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
 * Verifies that `/user/info` surfaces the Typesense probe result.
 *
 * When the fake cluster reports `health.ok: true`, the probe should
 * report `up`. Flipping the fake to unhealthy should flip the probe to
 * `down` without bringing /info itself down.
 */

const USER_PROFILES_TABLE = "UserProfiles-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";
const TEST_USER_ID = "01HXPROBE0000000000000000AA";
const STAGE = "dev";

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

  // Bun shares process state across test files — drop cached singletons.
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

  fakeClient = createFakeTypesenseClient();

  const api = await import("@s-user/functions/api");
  app = api.default;

  const search = await import("@s/shared/search");
  search.__setClientsForTests({ search: fakeClient.client });
});

afterAll(async () => {
  const search = await import("@s/shared/search");
  search.__resetClientCacheForTests();
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  await jwt.stop();
  await dynamo.stop();
});

describe("GET /user/info — Typesense probe", () => {
  test("reports up when the cluster responds healthy", async () => {
    fakeClient.setHealthy(true);
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{
      data: { probes: { typesense: { status: string } } };
    }>(app, "/user/info", { token });
    expect(res.status).toBe(200);
    expect(res.body.data.probes.typesense.status).toBe("up");
  });

  test("reports down when the cluster reports unhealthy", async () => {
    fakeClient.setHealthy(false);
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{
      data: { probes: { typesense: { status: string; detail?: string } } };
    }>(app, "/user/info", { token });
    expect(res.status).toBe(200);
    expect(res.body.data.probes.typesense.status).toBe("down");
  });
});
