import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { envLimit } from "../functions/src/routes/_env";

describe("envLimit", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.RATE_LIMIT_TEST_VAR;
  });

  afterEach(() => {
    process.env.RATE_LIMIT_TEST_VAR = original ?? "";
  });

  test("returns the default when env var is empty string", () => {
    process.env.RATE_LIMIT_TEST_VAR = "";
    expect(envLimit("RATE_LIMIT_TEST_VAR", 7)).toBe(7);
  });

  test("parses a positive integer override", () => {
    process.env.RATE_LIMIT_TEST_VAR = "100";
    expect(envLimit("RATE_LIMIT_TEST_VAR", 7)).toBe(100);
  });

  test("throws on zero", () => {
    process.env.RATE_LIMIT_TEST_VAR = "0";
    expect(() => envLimit("RATE_LIMIT_TEST_VAR", 7)).toThrow(/positive integer/);
  });

  test("throws on negative", () => {
    process.env.RATE_LIMIT_TEST_VAR = "-3";
    expect(() => envLimit("RATE_LIMIT_TEST_VAR", 7)).toThrow(/positive integer/);
  });

  test("throws on non-numeric", () => {
    process.env.RATE_LIMIT_TEST_VAR = "abc";
    expect(() => envLimit("RATE_LIMIT_TEST_VAR", 7)).toThrow(/positive integer/);
  });
});
