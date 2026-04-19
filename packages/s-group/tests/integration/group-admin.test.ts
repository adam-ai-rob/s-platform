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

const GROUPS_TABLE = "Groups-test";
const GROUP_USERS_TABLE = "GroupUsers-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";

const ADMIN_USER_ID = "01HXADMIN00000000000000000A";
const MEMBER_USER_ID = "01HXMEMBER0000000000000000M";

let dynamo: LocalDynamo;
let jwt: JwtStub;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported Hono app
let app: any;

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.GROUPS_TABLE_NAME = GROUPS_TABLE;
  process.env.GROUP_USERS_TABLE_NAME = GROUP_USERS_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";

  await createTable(dynamo.endpoint, {
    tableName: GROUPS_TABLE,
    partitionKey: "id",
    indexes: [{ indexName: "ByName", partitionKey: "name" }],
  });
  await createTable(dynamo.endpoint, {
    tableName: GROUP_USERS_TABLE,
    partitionKey: "id",
    indexes: [
      { indexName: "ByGroupId", partitionKey: "groupId" },
      { indexName: "ByUserId", partitionKey: "userId" },
    ],
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);

  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, ADMIN_USER_ID, [{ id: "group_admin" }]);
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, MEMBER_USER_ID, []);

  const api = await import("@s-group/functions/api");
  app = api.default;
});

afterAll(async () => {
  await jwt.stop();
  await dynamo.stop();
});

describe("s-group admin flow (integration)", () => {
  test("non-admin → 403 on POST /admin/groups", async () => {
    const token = await jwt.sign({ sub: MEMBER_USER_ID });
    const res = await invoke(app, "/group/admin/groups", {
      method: "POST",
      token,
      body: { name: "should-fail" },
    });
    expect(res.status).toBe(403);
  });

  test("create group → add member → list member's groups → remove", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });

    // 1. Create a group
    const createRes = await invoke<{ data: { id: string; name: string } }>(
      app,
      "/group/admin/groups",
      {
        method: "POST",
        token: adminToken,
        body: {
          name: "platform-engineers",
          description: "Builders of the platform",
          type: "team",
          emailDomainNames: [],
          automaticUserAssignment: false,
        },
      },
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("platform-engineers");
    const groupId = createRes.body.data.id;

    // 2. Add the member
    const addRes = await invoke(app, `/group/admin/groups/${groupId}/users/${MEMBER_USER_ID}`, {
      method: "POST",
      token: adminToken,
    });
    expect(addRes.status).toBe(204);

    // 3. Member lists their own groups
    const memberToken = await jwt.sign({ sub: MEMBER_USER_ID });
    const listRes = await invoke<{ data: { groupId: string; status: string }[] }>(
      app,
      "/group/user/me/groups",
      { token: memberToken },
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((m) => m.groupId === groupId && m.status === "active")).toBe(
      true,
    );

    // 4. Remove the member
    const removeRes = await invoke(app, `/group/admin/groups/${groupId}/users/${MEMBER_USER_ID}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(removeRes.status).toBe(204);

    // 5. Confirm membership gone from the member's perspective
    const listAfter = await invoke<{ data: { groupId: string; status: string }[] }>(
      app,
      "/group/user/me/groups",
      { token: memberToken },
    );
    expect(listAfter.body.data.some((m) => m.groupId === groupId && m.status === "active")).toBe(
      false,
    );
  });

  test("GET /admin/groups/{id} returns the created group", async () => {
    const token = await jwt.sign({ sub: ADMIN_USER_ID });
    const create = await invoke<{ data: { id: string } }>(app, "/group/admin/groups", {
      method: "POST",
      token,
      body: { name: "ops", automaticUserAssignment: false },
    });
    const id = create.body.data.id;
    const getRes = await invoke<{ data: { id: string; name: string } }>(
      app,
      `/group/admin/groups/${id}`,
      { token },
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe("ops");
  });
});
