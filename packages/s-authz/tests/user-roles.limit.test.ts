import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ValidationError } from "@s/shared/errors";
import { type LocalDynamo, createTable, startLocalDynamo } from "@s/shared/testing";

const ROLES_TABLE = "AuthzRoles-limit-test";
const USER_ROLES_TABLE = "AuthzUserRoles-limit-test";
const VIEW_TABLE = "AuthzView-limit-test";

let dynamo: LocalDynamo;

beforeAll(async () => {
  dynamo = await startLocalDynamo();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.AUTHZ_ROLES_TABLE_NAME = ROLES_TABLE;
  process.env.AUTHZ_USER_ROLES_TABLE_NAME = USER_ROLES_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = VIEW_TABLE;

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
    tableName: VIEW_TABLE,
    partitionKey: "userId",
  });
});

afterAll(async () => {
  await dynamo.stop();
});

describe("assignRoleToUser limits", () => {
  test("throws ValidationError when assigning a role with too many values", async () => {
    const { createRole } = await import("../core/src/roles/roles.service");
    const { assignRoleToUser } = await import("../core/src/user-roles/user-roles.service");
    const { MAX_ASSIGNMENT_VALUES } = await import("../core/src/user-roles/user-roles.entity");

    const role = await createRole({
      name: "too-many-values-role",
      permissions: [{ id: "p1", value: [] }],
    });

    const values = Array.from({ length: MAX_ASSIGNMENT_VALUES + 1 }, (_, i) => `val-${i}`);

    await expect(
      assignRoleToUser({
        userId: "user-1",
        roleId: role.id,
        value: values,
        createdBy: "admin",
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("throws ValidationError when merging results in too many values", async () => {
    const { createRole } = await import("../core/src/roles/roles.service");
    const { assignRoleToUser } = await import("../core/src/user-roles/user-roles.service");
    const { MAX_ASSIGNMENT_VALUES } = await import("../core/src/user-roles/user-roles.entity");

    const role = await createRole({
      name: "merge-limit-role",
      permissions: [{ id: "p1", value: [] }],
    });

    // Assign some values
    await assignRoleToUser({
      userId: "user-2",
      roleId: role.id,
      value: Array.from({ length: MAX_ASSIGNMENT_VALUES - 10 }, (_, i) => `val-${i}`),
      createdBy: "admin",
    });

    // Add more values that exceed the limit
    await expect(
      assignRoleToUser({
        userId: "user-2",
        roleId: role.id,
        value: Array.from({ length: 20 }, (_, i) => `val-${i + 1000}`),
        createdBy: "admin",
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("allows assigning up to the limit", async () => {
    const { createRole } = await import("../core/src/roles/roles.service");
    const { assignRoleToUser } = await import("../core/src/user-roles/user-roles.service");
    const { MAX_ASSIGNMENT_VALUES } = await import("../core/src/user-roles/user-roles.entity");

    const role = await createRole({
      name: "limit-edge-role",
      permissions: [{ id: "p1", value: [] }],
    });

    const values = Array.from({ length: MAX_ASSIGNMENT_VALUES }, (_, i) => `val-${i}`);

    await assignRoleToUser({
      userId: "user-3",
      roleId: role.id,
      value: values,
      createdBy: "admin",
    });
  });
});
