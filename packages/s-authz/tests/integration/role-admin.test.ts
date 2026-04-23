import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "@s/shared/ddb";
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

const ROLES_TABLE = "AuthzRoles-test";
const USER_ROLES_TABLE = "AuthzUserRoles-test";
const GROUP_ROLES_TABLE = "AuthzGroupRoles-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";

const ADMIN_USER_ID = "01HXADMIN00000000000000000A";
const TARGET_USER_ID = "01HXTARGET0000000000000000T";

let dynamo: LocalDynamo;
let jwt: JwtStub;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported Hono app
let app: any;

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.AUTHZ_ROLES_TABLE_NAME = ROLES_TABLE;
  process.env.AUTHZ_USER_ROLES_TABLE_NAME = USER_ROLES_TABLE;
  process.env.AUTHZ_GROUP_ROLES_TABLE_NAME = GROUP_ROLES_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";

  await createTable(dynamo.endpoint, {
    tableName: ROLES_TABLE,
    partitionKey: "id",
    indexes: [{ indexName: "ByName", partitionKey: "name" }],
  });
  await createTable(dynamo.endpoint, {
    tableName: USER_ROLES_TABLE,
    partitionKey: "id",
    indexes: [
      { indexName: "ByUserId", partitionKey: "userId" },
      { indexName: "ByRoleId", partitionKey: "roleId" },
    ],
  });
  await createTable(dynamo.endpoint, {
    tableName: GROUP_ROLES_TABLE,
    partitionKey: "id",
    indexes: [
      { indexName: "ByGroupId", partitionKey: "groupId" },
      { indexName: "ByRoleId", partitionKey: "roleId" },
    ],
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);

  // Seed the admin caller with the authz_admin permission so their
  // bearer token passes requirePermission("authz_admin") on /admin routes.
  await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, ADMIN_USER_ID, [{ id: "authz_admin" }]);

  const api = await import("@s-authz/functions/api");
  app = api.default;
});

afterAll(async () => {
  await jwt.stop();
  await dynamo.stop();
});

describe("s-authz admin flow (integration)", () => {
  test("non-admin → 403 on POST /admin/roles", async () => {
    const outsiderId = "01HXOUTSIDER0000000000000OUT";
    await seedAuthzViewEntry(AUTHZ_VIEW_TABLE, outsiderId, []);
    const token = await jwt.sign({ sub: outsiderId });
    const res = await invoke(app, "/authz/admin/roles", {
      method: "POST",
      token,
      body: { name: "should-fail", permissions: [] },
    });
    expect(res.status).toBe(403);
  });

  test("create role → assign to user → verify AuthzView rebuilt", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });

    // 1. Create role with one permission
    const createRes = await invoke<{ data: { id: string; name: string } }>(
      app,
      "/authz/admin/roles",
      {
        method: "POST",
        token: adminToken,
        body: {
          name: "widget-editor",
          description: "Can edit widgets",
          permissions: [{ id: "widget_edit" }],
        },
      },
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("widget-editor");
    const roleId = createRes.body.data.id;

    // 2. Assign to the target user
    const assignRes = await invoke(app, `/authz/admin/users/${TARGET_USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
    });
    expect(assignRes.status).toBe(204);

    // 3. Verify AuthzView for target user now contains widget_edit
    const viewRow = await getDdbClient().send(
      new GetCommand({ TableName: AUTHZ_VIEW_TABLE, Key: { userId: TARGET_USER_ID } }),
    );
    const perms = (viewRow.Item?.permissions ?? []) as { id: string }[];
    expect(perms.some((p) => p.id === "widget_edit")).toBe(true);

    // 4. Unassign → view no longer has widget_edit
    const unassignRes = await invoke(app, `/authz/admin/users/${TARGET_USER_ID}/roles/${roleId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(unassignRes.status).toBe(204);

    const viewAfterUnassign = await getDdbClient().send(
      new GetCommand({ TableName: AUTHZ_VIEW_TABLE, Key: { userId: TARGET_USER_ID } }),
    );
    const permsAfter = (viewAfterUnassign.Item?.permissions ?? []) as { id: string }[];
    expect(permsAfter.some((p) => p.id === "widget_edit")).toBe(false);
  });

  test("scoped assignment unions values across two POST calls", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });
    const USER_ID = "01HXSCOPED0000000000000SCOP";

    // 1. Create a scoped role (empty-array value marker on the permission
    //    template → `resolvePermissionsForAssignments` treats it as
    //    scope-required and folds in the assignment value).
    const createRes = await invoke<{ data: { id: string } }>(app, "/authz/admin/roles", {
      method: "POST",
      token: adminToken,
      body: {
        name: "building-admin-scoped-test",
        description: "test-only",
        permissions: [{ id: "building_admin", value: [] }],
      },
    });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.data.id;

    // 2. First assignment: scope [A, B]
    const assign1 = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
      body: { value: ["bld-A", "bld-B"] },
    });
    expect(assign1.status).toBe(204);

    // 3. Second assignment (same user + role): scope [C] — should union
    const assign2 = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
      body: { value: ["bld-C"] },
    });
    expect(assign2.status).toBe(204);

    // 4. AuthzView should have exactly one `building_admin` entry with
    //    value [A, B, C] (order-insensitive).
    const viewRow = await getDdbClient().send(
      new GetCommand({ TableName: AUTHZ_VIEW_TABLE, Key: { userId: USER_ID } }),
    );
    const perms = (viewRow.Item?.permissions ?? []) as { id: string; value?: unknown[] }[];
    const buildingAdmin = perms.filter((p) => p.id === "building_admin");
    expect(buildingAdmin).toHaveLength(1);
    expect(new Set(buildingAdmin[0]?.value)).toEqual(new Set(["bld-A", "bld-B", "bld-C"]));
  });

  test("identical re-assignment is a no-op (no DDB write, no value change)", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });
    const USER_ID = "01HXNOOP0000000000000000NOP";

    const createRes = await invoke<{ data: { id: string } }>(app, "/authz/admin/roles", {
      method: "POST",
      token: adminToken,
      body: {
        name: "building-admin-noop-test",
        description: "test-only",
        permissions: [{ id: "building_admin", value: [] }],
      },
    });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.data.id;

    const first = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
      body: { value: ["bld-X"] },
    });
    expect(first.status).toBe(204);

    // Same value, same user, same role — the service should recognise the
    // no-op and skip the write + rebuild. We can't introspect writes from
    // the outside, but the AuthzView should still contain exactly the same
    // permission shape.
    const second = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
      body: { value: ["bld-X"] },
    });
    expect(second.status).toBe(204);

    const viewRow = await getDdbClient().send(
      new GetCommand({ TableName: AUTHZ_VIEW_TABLE, Key: { userId: USER_ID } }),
    );
    const perms = (viewRow.Item?.permissions ?? []) as { id: string; value?: unknown[] }[];
    const buildingAdmin = perms.filter((p) => p.id === "building_admin");
    expect(buildingAdmin).toHaveLength(1);
    expect(buildingAdmin[0]?.value).toEqual(["bld-X"]);
  });

  test("malformed body (value not an array) → 400 from zod validation", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });
    const USER_ID = "01HXBADBODY000000000000BAD0";

    const createRes = await invoke<{ data: { id: string } }>(app, "/authz/admin/roles", {
      method: "POST",
      token: adminToken,
      body: {
        name: "building-admin-badbody-test",
        description: "test-only",
        permissions: [{ id: "building_admin", value: [] }],
      },
    });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.data.id;

    // `value` must be an array. An object should be rejected by zod-openapi
    // before the handler runs — this verifies we're not silently coercing.
    const res = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
      body: { value: { "0": "bld-A" } },
    });
    expect(res.status).toBe(400);
  });

  test("scope-free assignment still works — no body, no value field on the resulting permission", async () => {
    const adminToken = await jwt.sign({ sub: ADMIN_USER_ID });
    const USER_ID = "01HXSUPERADMN00000000000SUP";

    // Role whose template has NO `value` field — global permission.
    const createRes = await invoke<{ data: { id: string } }>(app, "/authz/admin/roles", {
      method: "POST",
      token: adminToken,
      body: {
        name: "building-superadmin-test",
        description: "test-only",
        permissions: [{ id: "building_superadmin" }],
      },
    });
    expect(createRes.status).toBe(201);
    const roleId = createRes.body.data.id;

    // Assign without body — should work.
    const assignRes = await invoke(app, `/authz/admin/users/${USER_ID}/roles/${roleId}`, {
      method: "POST",
      token: adminToken,
    });
    expect(assignRes.status).toBe(204);

    const viewRow = await getDdbClient().send(
      new GetCommand({ TableName: AUTHZ_VIEW_TABLE, Key: { userId: USER_ID } }),
    );
    const perms = (viewRow.Item?.permissions ?? []) as { id: string; value?: unknown[] }[];
    const superadmin = perms.find((p) => p.id === "building_superadmin");
    expect(superadmin).toBeDefined();
    expect(superadmin?.value).toBeUndefined();
  });

  test("GET /user/me/permissions reflects seeded view", async () => {
    const token = await jwt.sign({ sub: ADMIN_USER_ID });
    const res = await invoke<{ data: { userId: string; permissions: { id: string }[] } }>(
      app,
      "/authz/user/me/permissions",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(ADMIN_USER_ID);
    expect(res.body.data.permissions.some((p) => p.id === "authz_admin")).toBe(true);
  });
});
