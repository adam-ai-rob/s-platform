import { describe, expect, test } from "bun:test";
import { createAuthnUser } from "../core/src/users/users.entity";

describe("createAuthnUser", () => {
  test("lowercases and trims email", () => {
    const user = createAuthnUser({ email: "  Alice@Example.com  " });
    expect(user.email).toBe("alice@example.com");
  });

  test("generates ULID id", () => {
    const user = createAuthnUser({ email: "a@b.com" });
    expect(user.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("defaults flags to safe values", () => {
    const user = createAuthnUser({ email: "a@b.com" });
    expect(user.enabled).toBe(true);
    expect(user.emailVerified).toBe(false);
    expect(user.passwordExpired).toBe(false);
    expect(user.system).toBe(false);
  });

  test("system flag can be set explicitly", () => {
    const user = createAuthnUser({ email: "svc@system.local", system: true });
    expect(user.system).toBe(true);
  });

  test("createdAt and updatedAt are equal and ISO-8601", () => {
    const user = createAuthnUser({ email: "a@b.com" });
    expect(user.createdAt).toBe(user.updatedAt);
    expect(user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
