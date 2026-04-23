import { describe, expect, test } from "bun:test";

// Roles/user-roles repos read env vars at instantiation (module top-level).
// `import` statements are hoisted, so we must set env BEFORE the repository
// modules load — use dynamic `await import` in the test setup.
process.env.AUTHZ_ROLES_TABLE_NAME ??= "AuthzRoles-unit-test";
process.env.AUTHZ_USER_ROLES_TABLE_NAME ??= "AuthzUserRoles-unit-test";
process.env.AUTHZ_GROUP_ROLES_TABLE_NAME ??= "AuthzGroupRoles-unit-test";
process.env.AUTHZ_VIEW_TABLE_NAME ??= "AuthzView-unit-test";

type AuthzRole = import("../core/src/roles/roles.entity").AuthzRole;
type AuthzUserRole = import("../core/src/user-roles/user-roles.entity").AuthzUserRole;

const rolesModule = await import("../core/src/roles/roles.repository");
const viewService = await import("../core/src/view/view.service");
const { resolvePermissionsForAssignments } = viewService;

const originalFindById = rolesModule.authzRolesRepository.findById.bind(
  rolesModule.authzRolesRepository,
);

function stubRoles(roles: AuthzRole[]): void {
  const byId = new Map(roles.map((r) => [r.id, r]));
  // biome-ignore lint/suspicious/noExplicitAny: test-local stub
  (rolesModule.authzRolesRepository as any).findById = async (id: string) =>
    byId.get(id) ?? undefined;
}

function restoreRoles(): void {
  // biome-ignore lint/suspicious/noExplicitAny: test-local stub
  (rolesModule.authzRolesRepository as any).findById = originalFindById;
}

function role(
  spec: Partial<AuthzRole> & { id: string; permissions: AuthzRole["permissions"] },
): AuthzRole {
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    permissions: spec.permissions,
    childRoleIds: spec.childRoleIds ?? [],
    system: spec.system ?? true,
    createdAt: spec.createdAt ?? "2026-04-23T00:00:00.000Z",
    updatedAt: spec.updatedAt ?? "2026-04-23T00:00:00.000Z",
    description: spec.description,
  };
}

function assignment(
  spec: Partial<AuthzUserRole> & { roleId: string; value?: unknown[] },
): AuthzUserRole {
  return {
    id: spec.id ?? `assign-${spec.roleId}-${Math.random().toString(36).slice(2, 8)}`,
    userId: spec.userId ?? "user-1",
    roleId: spec.roleId,
    value: spec.value,
    createdAt: spec.createdAt ?? "2026-04-23T00:00:00.000Z",
    createdBy: spec.createdBy ?? "admin",
  };
}

describe("resolvePermissionsForAssignments", () => {
  test("role template without `value` → global permission, assignment value ignored", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [{ id: "building_superadmin" }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["bld-A"] }),
      ]);
      expect(result).toEqual([{ id: "building_superadmin" }]);
    } finally {
      restoreRoles();
    }
  });

  test("role template with empty `value` + assignment value → populated scope", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [{ id: "building_admin", value: [] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["bld-A", "bld-B"] }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("building_admin");
      expect(new Set(result[0]?.value)).toEqual(new Set(["bld-A", "bld-B"]));
    } finally {
      restoreRoles();
    }
  });

  test("multiple assignments of same role with different scopes → unioned values", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [{ id: "building_admin", value: [] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["bld-A", "bld-B"] }),
        assignment({ roleId: "r1", value: ["bld-C"] }),
      ]);
      expect(result).toHaveLength(1);
      expect(new Set(result[0]?.value)).toEqual(new Set(["bld-A", "bld-B", "bld-C"]));
    } finally {
      restoreRoles();
    }
  });

  test("duplicate scope values across assignments are deduped", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [{ id: "building_admin", value: [] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["bld-A", "bld-B"] }),
        assignment({ roleId: "r1", value: ["bld-B", "bld-C"] }),
      ]);
      expect(result).toHaveLength(1);
      expect(new Set(result[0]?.value)).toEqual(new Set(["bld-A", "bld-B", "bld-C"]));
    } finally {
      restoreRoles();
    }
  });

  test("global + scoped assignment for same permission id → most-permissive (global) wins (scoped first)", async () => {
    stubRoles([
      role({
        id: "r-global",
        permissions: [{ id: "building_admin" }], // global role that happens to share permission id
      }),
      role({
        id: "r-scoped",
        permissions: [{ id: "building_admin", value: [] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r-scoped", value: ["bld-A"] }),
        assignment({ roleId: "r-global" }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "building_admin" });
    } finally {
      restoreRoles();
    }
  });

  test("global + scoped assignment for same permission id → most-permissive (global) wins (global first)", async () => {
    // Reverse-order variant: the global assignment comes BEFORE the scoped
    // one. Guards against order-dependent bugs in the merge logic.
    stubRoles([
      role({
        id: "r-global",
        permissions: [{ id: "building_admin" }],
      }),
      role({
        id: "r-scoped",
        permissions: [{ id: "building_admin", value: [] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r-global" }),
        assignment({ roleId: "r-scoped", value: ["bld-A"] }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "building_admin" });
    } finally {
      restoreRoles();
    }
  });

  test("template value + assignment value merged", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [{ id: "p1", value: ["preset-X"] }],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["per-user-Y"] }),
      ]);
      expect(result).toHaveLength(1);
      expect(new Set(result[0]?.value)).toEqual(new Set(["preset-X", "per-user-Y"]));
    } finally {
      restoreRoles();
    }
  });

  test("no assignments → empty permissions", async () => {
    stubRoles([]);
    try {
      const result = await resolvePermissionsForAssignments([]);
      expect(result).toEqual([]);
    } finally {
      restoreRoles();
    }
  });

  test("assignment referencing missing role is skipped (not thrown)", async () => {
    stubRoles([]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "nonexistent" }),
      ]);
      expect(result).toEqual([]);
    } finally {
      restoreRoles();
    }
  });

  test("two scope-required permissions on one role → both emitted with assignment value", async () => {
    stubRoles([
      role({
        id: "r1",
        permissions: [
          { id: "p1", value: [] },
          { id: "p2", value: [] },
        ],
      }),
    ]);
    try {
      const result = await resolvePermissionsForAssignments([
        assignment({ roleId: "r1", value: ["scope-1"] }),
      ]);
      expect(result).toHaveLength(2);
      for (const p of result) {
        expect(p.value).toEqual(["scope-1"]);
      }
    } finally {
      restoreRoles();
    }
  });
});
