import { afterEach, describe, expect, test } from "bun:test";
import { resolveCollectionName } from "./collections";

const originalStage = process.env.STAGE;

afterEach(() => {
  if (originalStage === undefined) {
    // biome-ignore lint/performance/noDelete: must truly remove the key; assigning undefined stringifies to "undefined".
    delete process.env.STAGE;
  } else {
    process.env.STAGE = originalStage;
  }
});

describe("resolveCollectionName", () => {
  test("prefixes entity with the current stage", () => {
    process.env.STAGE = "dev";
    expect(resolveCollectionName("users")).toBe("dev_users");
  });

  test("supports personal stage names with hyphens", () => {
    expect(resolveCollectionName("users", "robert")).toBe("robert_users");
    expect(resolveCollectionName("users", "alex-feature-x")).toBe("alex-feature-x_users");
  });

  test("throws when STAGE is missing and none supplied", () => {
    // biome-ignore lint/performance/noDelete: must truly remove the key; assigning undefined stringifies to "undefined".
    delete process.env.STAGE;
    expect(() => resolveCollectionName("users")).toThrow(/STAGE env var not set/);
  });

  test("rejects uppercase stage names", () => {
    expect(() => resolveCollectionName("users", "Prod")).toThrow(/Invalid stage name/);
  });

  test("rejects entity names starting with digits", () => {
    expect(() => resolveCollectionName("9users", "dev")).toThrow(/Invalid entity name/);
  });

  test("rejects entity names with uppercase", () => {
    expect(() => resolveCollectionName("Users", "dev")).toThrow(/Invalid entity name/);
  });
});
