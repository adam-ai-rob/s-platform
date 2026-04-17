import { describe, expect, test } from "bun:test";
import { createEmptyProfile } from "../core/src/profiles/profiles.entity";

describe("createEmptyProfile", () => {
  test("uses provided userId as the key", () => {
    const p = createEmptyProfile("01HXYZ");
    expect(p.userId).toBe("01HXYZ");
  });

  test("fields default to empty / zero values", () => {
    const p = createEmptyProfile("01HXYZ");
    expect(p.firstName).toBe("");
    expect(p.lastName).toBe("");
    expect(p.avatarUrl).toBeUndefined();
    expect(p.preferences).toEqual({});
    expect(p.metadata).toEqual({});
  });

  test("createdAt equals updatedAt and is ISO-8601", () => {
    const p = createEmptyProfile("01HXYZ");
    expect(p.createdAt).toBe(p.updatedAt);
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
