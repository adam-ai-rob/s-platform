import { describe, expect, test } from "bun:test";
import { isCollectionNotFound } from "../../core/src/search/buildings.search";

/**
 * Same guard as s-user — a fresh stage has no collection yet; the
 * indexer creates it lazily. This test freezes both the phrasing we
 * actually observe from Typesense Cloud and the asymmetric cases that
 * must NOT collapse into "empty results".
 */

function err(message: string, httpStatus = 404, name = "ObjectNotFound") {
  return Object.assign(new Error(message), { httpStatus, name });
}

describe("isCollectionNotFound", () => {
  test("matches the actual missing-collection message", () => {
    expect(isCollectionNotFound(err("Collection not found"))).toBe(true);
  });

  test("matches a wrapped message", () => {
    expect(
      isCollectionNotFound(err("Request failed with HTTP code 404 | Collection not found")),
    ).toBe(true);
  });

  test("does NOT match a missing-field 404", () => {
    expect(
      isCollectionNotFound(err("Could not find a field named `id` in the schema for sorting.")),
    ).toBe(false);
  });

  test("does NOT match a 401 even if the message mentions 'collection not found'", () => {
    expect(isCollectionNotFound(err("Collection access denied, collection not found", 401))).toBe(
      false,
    );
  });

  test("ignores non-error inputs", () => {
    expect(isCollectionNotFound(undefined)).toBe(false);
    expect(isCollectionNotFound(null)).toBe(false);
    expect(isCollectionNotFound("some string")).toBe(false);
  });
});
