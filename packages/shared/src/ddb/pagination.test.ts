import { describe, expect, test } from "bun:test";
import { decodeNextToken, encodeNextToken } from "./pagination";

describe("pagination tokens", () => {
  test("encode and decode roundtrip", () => {
    const key = { id: "01HXYZ", sk: "2026-04-17T10:30:00.000Z" };
    const token = encodeNextToken(key);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const decoded = decodeNextToken(token);
    expect(decoded).toEqual(key);
  });

  test("encode undefined → undefined", () => {
    expect(encodeNextToken(undefined)).toBeUndefined();
  });

  test("decode undefined → undefined", () => {
    expect(decodeNextToken(undefined)).toBeUndefined();
  });

  test("decode invalid token → undefined (no throw)", () => {
    expect(decodeNextToken("not-base64-json")).toBeUndefined();
  });

  test("token is base64url (no +, /, or =)", () => {
    const token = encodeNextToken({ id: "has+slash/and=padding" });
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });
});
