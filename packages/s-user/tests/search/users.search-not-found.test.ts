import { describe, expect, test } from "bun:test";
import { isCollectionNotFound } from "../../core/src/search/users.search";

/**
 * `isCollectionNotFound` is the guard that decides whether a 404 from
 * Typesense is "collection not created yet" (→ return empty results)
 * or "real bug" (→ surface as 500). Both cases come back with
 * `httpStatus: 404` and `name: "ObjectNotFound"`, so the only signal
 * is the message body. Freezing both known shapes as tests so a
 * library update that changes either phrasing breaks this suite loudly.
 */

function err(message: string, httpStatus = 404, name = "ObjectNotFound") {
  return Object.assign(new Error(message), { httpStatus, name });
}

describe("isCollectionNotFound", () => {
  test("matches Typesense's actual missing-collection message", () => {
    // Verified against Typesense Cloud v30 — it literally returns
    // `{"message":"Collection not found"}` with httpStatus 404 when
    // you hit `/collections/<name>/documents/search` for a missing
    // collection. Freezing this exact shape so a library update that
    // rewords it breaks here loudly (rather than silently regressing
    // search behaviour for fresh stages).
    expect(isCollectionNotFound(err("Collection not found"))).toBe(true);
  });

  test("matches when the message is wrapped (e.g. 'Request failed… Collection not found')", () => {
    expect(
      isCollectionNotFound(err("Request failed with HTTP code 404 | Collection not found")),
    ).toBe(true);
  });

  test("does NOT match the sort-field-missing 404", () => {
    expect(
      isCollectionNotFound(err("Could not find a field named `id` in the schema for sorting.")),
    ).toBe(false);
  });

  test("does NOT match a query-by-field missing 404", () => {
    expect(isCollectionNotFound(err("Could not find a field named `ssn` in the schema."))).toBe(
      false,
    );
  });

  test("does NOT match a 401 unauthorized even if the message mentions 'collection not found'", () => {
    expect(isCollectionNotFound(err("Collection access denied, collection not found", 401))).toBe(
      false,
    );
  });

  test("does NOT match a non-404 500 server error", () => {
    expect(isCollectionNotFound(err("Internal server error", 500))).toBe(false);
  });

  test("ignores non-error inputs", () => {
    expect(isCollectionNotFound(undefined)).toBe(false);
    expect(isCollectionNotFound(null)).toBe(false);
    expect(isCollectionNotFound("some string")).toBe(false);
    expect(isCollectionNotFound(404)).toBe(false);
  });
});
