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

const USER_PROFILES_TABLE = "UserProfiles-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";
const TEST_USER_ID = "01HXTESTUSER000000000000000";

let dynamo: LocalDynamo;
let jwt: JwtStub;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported Hono app
let app: any;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported service
let handleUserRegistered: any;

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.USER_PROFILES_TABLE_NAME = USER_PROFILES_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";

  await createTable(dynamo.endpoint, {
    tableName: USER_PROFILES_TABLE,
    partitionKey: "userId",
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);

  // Seed the caller's authz view so authMiddleware can load permissions.
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, TEST_USER_ID, []);

  // Dynamic imports AFTER env vars set, so the repository singleton reads
  // the table name at construction time.
  const api = await import("@s-user/functions/api");
  app = api.default;

  const service = await import("@s-user/core/profiles/profiles.service");
  handleUserRegistered = service.handleUserRegistered;

  // Seed a profile row for the caller via the event handler (same code
  // path the deployed `user.registered` subscriber takes).
  await handleUserRegistered({ userId: TEST_USER_ID, email: "test@example.com" });
});

afterAll(async () => {
  await jwt.stop();
  await dynamo.stop();
});

describe("s-user profile CRUD (integration)", () => {
  test("GET /user/health is public", async () => {
    const res = await invoke(app, "/user/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("GET /user/me returns the caller's profile", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{ data: { userId: string; firstName: string } }>(app, "/user/me", {
      token,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(TEST_USER_ID);
    expect(res.body.data.firstName).toBe("");
  });

  test("GET /user/me without bearer → 401", async () => {
    const res = await invoke(app, "/user/me");
    expect(res.status).toBe(401);
  });

  test("PATCH /user/me updates fields and returns the merged profile", async () => {
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{ data: { firstName: string; lastName: string } }>(app, "/user/me", {
      method: "PATCH",
      token,
      body: { firstName: "Ada", lastName: "Lovelace" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe("Ada");
    expect(res.body.data.lastName).toBe("Lovelace");
  });

  test("GET /user/{id} returns a different user's profile", async () => {
    const otherId = "01HXOTHER000000000000000000";
    await handleUserRegistered({ userId: otherId, email: "other@example.com" });
    const token = await jwt.sign({ sub: TEST_USER_ID });
    const res = await invoke<{ data: { userId: string } }>(app, `/user/${otherId}`, { token });
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(otherId);
  });
});
