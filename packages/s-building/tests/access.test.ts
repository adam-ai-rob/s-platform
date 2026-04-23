import { describe, expect, test } from "bun:test";
import type { UserContext } from "@s/shared/types";
import type { Context } from "hono";
import {
  buildingAccess,
  callerScopedBuildingIds,
  hasSuperadmin,
} from "../functions/src/routes/_access";
import type { AppEnv } from "../functions/src/types";

function user(
  overrides: Partial<UserContext> & { permissions?: UserContext["permissions"] } = {},
): UserContext {
  return {
    userId: "01HXYUSER000000000000000000",
    permissions: [],
    ...overrides,
  };
}

/**
 * `buildingAccess` takes a Hono `Context` but only ever reads
 * `c.get("user")`. A minimal stub is enough for unit coverage — no
 * need to spin up a real Hono app.
 */
function ctx(u: UserContext): Context<AppEnv> {
  return {
    get(key: string) {
      if (key === "user") return u;
      return undefined;
    },
  } as unknown as Context<AppEnv>;
}

describe("hasSuperadmin", () => {
  test("true when the caller carries building_superadmin (global, no value)", () => {
    expect(hasSuperadmin(user({ permissions: [{ id: "building_superadmin" }] }))).toBe(true);
  });

  test("false when the caller has only scoped roles", () => {
    expect(hasSuperadmin(user({ permissions: [{ id: "building_admin", value: ["b1"] }] }))).toBe(
      false,
    );
  });

  test("false when the caller has no permissions", () => {
    expect(hasSuperadmin(user())).toBe(false);
  });
});

describe("callerScopedBuildingIds", () => {
  test("unions values across the listed permissions; dedupes", () => {
    const ids = callerScopedBuildingIds(
      user({
        permissions: [
          { id: "building_admin", value: ["b1", "b2"] },
          { id: "building_manager", value: ["b2", "b3"] },
          { id: "building_user", value: ["b4"] }, // ignored
        ],
      }),
      ["building_admin", "building_manager"],
    );
    expect([...ids].sort()).toEqual(["b1", "b2", "b3"]);
  });

  test("skips permissions without a `value` (global variant)", () => {
    // `building_admin` without value is nonsensical today (role
    // template has `value: []`) but the guard is defensive — a global
    // grant should not be reported as a specific scope list.
    const ids = callerScopedBuildingIds(user({ permissions: [{ id: "building_admin" }] }), [
      "building_admin",
    ]);
    expect(ids).toEqual([]);
  });

  test("ignores non-string entries in value[] defensively", () => {
    const ids = callerScopedBuildingIds(
      user({ permissions: [{ id: "building_admin", value: ["b1", 42, null, "b2"] }] }),
      ["building_admin"],
    );
    expect([...ids].sort()).toEqual(["b1", "b2"]);
  });

  test("empty `value: []` contributes nothing", () => {
    const ids = callerScopedBuildingIds(
      user({ permissions: [{ id: "building_admin", value: [] }] }),
      ["building_admin"],
    );
    expect(ids).toEqual([]);
  });
});

describe("buildingAccess", () => {
  test("superadmin is granted regardless of which permission set the caller asks about", () => {
    const c = ctx(user({ permissions: [{ id: "building_superadmin" }] }));
    expect(buildingAccess(c, "b1", ["building_admin"])).toBe(true);
    expect(buildingAccess(c, "anything", ["building_user"])).toBe(true);
  });

  test("system tokens bypass scope", () => {
    const c = ctx(user({ system: true, permissions: [] }));
    expect(buildingAccess(c, "b1", ["building_admin"])).toBe(true);
  });

  test("scoped admin with matching value is granted", () => {
    const c = ctx(user({ permissions: [{ id: "building_admin", value: ["b1", "b2"] }] }));
    expect(buildingAccess(c, "b1", ["building_admin"])).toBe(true);
    expect(buildingAccess(c, "b2", ["building_admin"])).toBe(true);
  });

  test("scoped admin without matching value is denied", () => {
    const c = ctx(user({ permissions: [{ id: "building_admin", value: ["b1"] }] }));
    expect(buildingAccess(c, "b9", ["building_admin"])).toBe(false);
  });

  test("manager permission is accepted when included in the gate's permission list", () => {
    const c = ctx(user({ permissions: [{ id: "building_manager", value: ["b1"] }] }));
    expect(buildingAccess(c, "b1", ["building_admin", "building_manager"])).toBe(true);
    // archive/activate/delete gate excludes manager → 403
    expect(buildingAccess(c, "b1", ["building_admin"])).toBe(false);
  });

  test("caller with no matching permission is denied", () => {
    const c = ctx(user({ permissions: [{ id: "building_user", value: ["b1"] }] }));
    expect(buildingAccess(c, "b1", ["building_admin", "building_manager"])).toBe(false);
  });

  test("global permission (no value field) grants access to any id in the set", () => {
    // Not expected on the current role templates but covers the defensive branch.
    const c = ctx(user({ permissions: [{ id: "building_admin" }] }));
    expect(buildingAccess(c, "anything", ["building_admin"])).toBe(true);
  });

  test("empty permissions array is denied", () => {
    const c = ctx(user({ permissions: [] }));
    expect(buildingAccess(c, "b1", ["building_admin"])).toBe(false);
  });
});
