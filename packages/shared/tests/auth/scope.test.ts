import { describe, expect, test } from "bun:test";
import { collectScopeValues, hasPermission, scopedAccess } from "../../src/auth";
import type { UserContext } from "../../src/types";

function user(
  overrides: Partial<UserContext> & { permissions?: UserContext["permissions"] } = {},
): UserContext {
  return {
    userId: "01HXYUSER000000000000000000",
    permissions: [],
    ...overrides,
  };
}

describe("hasPermission", () => {
  test("true when the caller carries the requested global permission", () => {
    expect(
      hasPermission(user({ permissions: [{ id: "building_superadmin" }] }), "building_superadmin"),
    ).toBe(true);
  });

  test("false when the caller has only other scoped roles", () => {
    expect(
      hasPermission(
        user({ permissions: [{ id: "building_admin", value: ["b1"] }] }),
        "building_superadmin",
      ),
    ).toBe(false);
  });

  test("false when the caller has no permissions", () => {
    expect(hasPermission(user(), "building_superadmin")).toBe(false);
  });
});

describe("collectScopeValues", () => {
  test("unions values across the listed permissions; dedupes", () => {
    const ids = collectScopeValues(
      user({
        permissions: [
          { id: "building_admin", value: ["b1", "b2"] },
          { id: "building_manager", value: ["b2", "b3"] },
          { id: "building_user", value: ["b4"] },
        ],
      }),
      ["building_admin", "building_manager"],
    );
    expect([...ids].sort()).toEqual(["b1", "b2", "b3"]);
  });

  test("skips permissions without a value field", () => {
    const ids = collectScopeValues(user({ permissions: [{ id: "building_admin" }] }), [
      "building_admin",
    ]);
    expect(ids).toEqual([]);
  });

  test("ignores non-string entries in value[] defensively", () => {
    const ids = collectScopeValues(
      user({ permissions: [{ id: "building_admin", value: ["b1", 42, null, "b2"] }] }),
      ["building_admin"],
    );
    expect([...ids].sort()).toEqual(["b1", "b2"]);
  });

  test("empty value[] contributes nothing", () => {
    const ids = collectScopeValues(user({ permissions: [{ id: "building_admin", value: [] }] }), [
      "building_admin",
    ]);
    expect(ids).toEqual([]);
  });
});

describe("scopedAccess", () => {
  const options = { superadminPermission: "building_superadmin" };

  test("superadmin is granted regardless of which permission set the caller asks about", () => {
    const caller = user({ permissions: [{ id: "building_superadmin" }] });
    expect(scopedAccess(caller, "b1", ["building_admin"], options)).toBe(true);
    expect(scopedAccess(caller, "anything", ["building_user"], options)).toBe(true);
  });

  test("system tokens bypass scope", () => {
    expect(scopedAccess(user({ system: true, permissions: [] }), "b1", ["building_admin"])).toBe(
      true,
    );
  });

  test("scoped admin with matching value is granted", () => {
    const caller = user({ permissions: [{ id: "building_admin", value: ["b1", "b2"] }] });
    expect(scopedAccess(caller, "b1", ["building_admin"], options)).toBe(true);
    expect(scopedAccess(caller, "b2", ["building_admin"], options)).toBe(true);
  });

  test("scoped admin without matching value is denied", () => {
    const caller = user({ permissions: [{ id: "building_admin", value: ["b1"] }] });
    expect(scopedAccess(caller, "b9", ["building_admin"], options)).toBe(false);
  });

  test("manager permission is accepted when included in the gate's permission list", () => {
    const caller = user({ permissions: [{ id: "building_manager", value: ["b1"] }] });
    expect(scopedAccess(caller, "b1", ["building_admin", "building_manager"], options)).toBe(true);
    expect(scopedAccess(caller, "b1", ["building_admin"], options)).toBe(false);
  });

  test("caller with no matching permission is denied", () => {
    const caller = user({ permissions: [{ id: "building_user", value: ["b1"] }] });
    expect(scopedAccess(caller, "b1", ["building_admin", "building_manager"], options)).toBe(false);
  });

  test("global permission without a value field grants access to any id in the set", () => {
    const caller = user({ permissions: [{ id: "building_admin" }] });
    expect(scopedAccess(caller, "anything", ["building_admin"], options)).toBe(true);
  });

  test("empty permissions array is denied", () => {
    expect(scopedAccess(user({ permissions: [] }), "b1", ["building_admin"], options)).toBe(false);
  });
});
