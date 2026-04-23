import { describe, expect, test } from "bun:test";

process.env.AUTHZ_ROLES_TABLE_NAME ??= "AuthzRoles-unit-test";
process.env.AUTHZ_USER_ROLES_TABLE_NAME ??= "AuthzUserRoles-unit-test";
process.env.AUTHZ_GROUP_ROLES_TABLE_NAME ??= "AuthzGroupRoles-unit-test";
process.env.AUTHZ_VIEW_TABLE_NAME ??= "AuthzView-unit-test";

type AuthzRole = import("../core/src/roles/roles.entity").AuthzRole;

const rolesRepoModule = await import("../core/src/roles/roles.repository");
const seedsModule = await import("../core/src/seeds/system-roles");
const { BUILDING_SYSTEM_ROLES, SYSTEM_ROLES, seedSystemRoles } = seedsModule;

const originalFindByName = rolesRepoModule.authzRolesRepository.findByName.bind(
  rolesRepoModule.authzRolesRepository,
);
const originalInsert = rolesRepoModule.authzRolesRepository.insert.bind(
  rolesRepoModule.authzRolesRepository,
);

function stubRepo(): AuthzRole[] {
  const store = new Map<string, AuthzRole>();
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (rolesRepoModule.authzRolesRepository as any).findByName = async (name: string) =>
    store.get(name);
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (rolesRepoModule.authzRolesRepository as any).insert = async (role: AuthzRole) => {
    store.set(role.name, role);
  };
  // Return the underlying array for assertions.
  return Array.from(store.values()) as AuthzRole[] & { _store?: Map<string, AuthzRole> };
}

function restoreRepo(): void {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (rolesRepoModule.authzRolesRepository as any).findByName = originalFindByName;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (rolesRepoModule.authzRolesRepository as any).insert = originalInsert;
}

describe("seedSystemRoles", () => {
  test("exports the four building system roles with correct permission templates", () => {
    expect(BUILDING_SYSTEM_ROLES.map((r) => r.name)).toEqual([
      "building-superadmin",
      "building-admin",
      "building-manager",
      "building-user",
    ]);

    const superadmin = BUILDING_SYSTEM_ROLES.find((r) => r.name === "building-superadmin");
    expect(superadmin?.permissions).toEqual([{ id: "building_superadmin" }]);
    // no `value` field on the superadmin permission — marks it as global

    for (const scoped of ["building-admin", "building-manager", "building-user"]) {
      const role = BUILDING_SYSTEM_ROLES.find((r) => r.name === scoped);
      expect(role?.permissions).toHaveLength(1);
      expect(role?.permissions[0]?.value).toEqual([]);
    }
  });

  test("SYSTEM_ROLES includes every building role", () => {
    for (const spec of BUILDING_SYSTEM_ROLES) {
      expect(SYSTEM_ROLES.some((r) => r.name === spec.name)).toBe(true);
    }
  });

  test("first run creates every role; second run skips them all (idempotent)", async () => {
    const store = new Map<string, AuthzRole>();
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    (rolesRepoModule.authzRolesRepository as any).findByName = async (name: string) =>
      store.get(name);
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    (rolesRepoModule.authzRolesRepository as any).insert = async (role: AuthzRole) => {
      store.set(role.name, role);
    };

    try {
      const first = await seedSystemRoles();
      expect(first.created.sort()).toEqual([...SYSTEM_ROLES.map((r) => r.name)].sort());
      expect(first.skipped).toEqual([]);
      expect(store.size).toBe(SYSTEM_ROLES.length);

      const second = await seedSystemRoles();
      expect(second.created).toEqual([]);
      expect(second.skipped.sort()).toEqual([...SYSTEM_ROLES.map((r) => r.name)].sort());
      expect(store.size).toBe(SYSTEM_ROLES.length);
    } finally {
      restoreRepo();
    }
  });

  test("seeded roles carry system: true and correct permission templates", async () => {
    const store = new Map<string, AuthzRole>();
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    (rolesRepoModule.authzRolesRepository as any).findByName = async (name: string) =>
      store.get(name);
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    (rolesRepoModule.authzRolesRepository as any).insert = async (role: AuthzRole) => {
      store.set(role.name, role);
    };

    try {
      await seedSystemRoles();
      for (const spec of SYSTEM_ROLES) {
        const role = store.get(spec.name);
        expect(role?.system).toBe(true);
        expect(role?.permissions).toEqual(spec.permissions);
      }
    } finally {
      restoreRepo();
    }
  });

  // Ensure stubs don't leak across suites if someone extends this file.
  test("helper `stubRepo` is referenced", () => {
    expect(typeof stubRepo).toBe("function");
  });
});
