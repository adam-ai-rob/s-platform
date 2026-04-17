import { describe, expect, test } from "bun:test";
import { createAuthzRole } from "../core/src/roles/roles.entity";

describe("createAuthzRole", () => {
  test("defaults permissions, childRoleIds, system", () => {
    const r = createAuthzRole({ name: "admin" });
    expect(r.permissions).toEqual([]);
    expect(r.childRoleIds).toEqual([]);
    expect(r.system).toBe(false);
  });

  test("accepts explicit fields", () => {
    const r = createAuthzRole({
      name: "viewer",
      description: "read-only",
      permissions: [{ id: "read_users" }],
      childRoleIds: ["01HX"],
      system: true,
    });
    expect(r.description).toBe("read-only");
    expect(r.permissions).toEqual([{ id: "read_users" }]);
    expect(r.childRoleIds).toEqual(["01HX"]);
    expect(r.system).toBe(true);
  });

  test("generates ULID id and ISO timestamps", () => {
    const r = createAuthzRole({ name: "x" });
    expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.createdAt).toBe(r.updatedAt);
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
