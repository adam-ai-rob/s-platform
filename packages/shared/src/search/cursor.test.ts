import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor } from "./cursor";

describe("cursor codec", () => {
  test("encodes and decodes a simple numeric cursor", () => {
    const token = encodeCursor({ sortValues: [1714500000], lastId: "u_abc" });
    const decoded = decodeCursor(token);
    expect(decoded).toEqual({ sortValues: [1714500000], lastId: "u_abc", v: 1 });
  });

  test("supports multi-field sort values", () => {
    const token = encodeCursor({ sortValues: [42, "Ada Lovelace"], lastId: "u_xyz" });
    const decoded = decodeCursor(token);
    expect(decoded?.sortValues).toEqual([42, "Ada Lovelace"]);
    expect(decoded?.lastId).toBe("u_xyz");
  });

  test("returns undefined for missing input", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
  });

  test("returns undefined for malformed base64", () => {
    expect(decodeCursor("not-a-cursor")).toBeUndefined();
  });

  test("returns undefined for wrong version", () => {
    const payload = Buffer.from(
      JSON.stringify({ sortValues: [1], lastId: "x", v: 999 }),
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(payload)).toBeUndefined();
  });

  test("returns undefined for malformed shape", () => {
    const payload = Buffer.from(JSON.stringify({ not: "a cursor" }), "utf8").toString("base64url");
    expect(decodeCursor(payload)).toBeUndefined();
  });

  test("uses URL-safe base64 (no + / = padding concerns)", () => {
    const token = encodeCursor({ sortValues: [Number.MAX_SAFE_INTEGER], lastId: "u" });
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });
});
