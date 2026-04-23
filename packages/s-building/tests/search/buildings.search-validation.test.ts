import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ValidationError } from "@s/shared/errors";
import { buildScopedIdFilter, searchBuildings } from "../../core/src/search/buildings.search";

/**
 * These tests only exercise the input-validation path of `searchBuildings`
 * — validators run before the Typesense client is constructed, so a bad
 * input throws `ValidationError` without any network access.
 *
 * A real end-to-end test with a live cluster lives in the `s-tests`
 * journey suite (#71).
 */

const originalStage = process.env.STAGE;

beforeAll(() => {
  process.env.STAGE = "test";
});

afterEach(() => {
  process.env.STAGE = originalStage;
});

describe("searchBuildings input validation", () => {
  test("rejects sort field not on the whitelist", async () => {
    await expect(searchBuildings({ sortBy: "ownerSsn:desc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects non asc/desc direction", async () => {
    await expect(searchBuildings({ sortBy: "createdAtMs:sideways" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects filter field not on the whitelist", async () => {
    await expect(searchBuildings({ filterBy: "ownerSsn:=1234" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects facet field not on the whitelist", async () => {
    await expect(searchBuildings({ facetBy: "ownerSsn" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("allows `id` in filter_by — drives scoped id:=[...] queries", async () => {
    // `id` is whitelisted for FILTER but not SORT (Typesense doesn't
    // permit declaring `id` as a sortable field). This test pins the
    // asymmetry so a later refactor doesn't accidentally drop it.
    await expect(searchBuildings({ sortBy: "id:desc" })).rejects.toBeInstanceOf(ValidationError);
    // A pure id-filter query shouldn't throw on validation — it may
    // still hit the collection-not-found branch since no cluster is
    // configured in this test.
    await expect(
      searchBuildings({ filterBy: "id:=[`01HX00000000000000000000AA`]" }),
    ).rejects.not.toBeInstanceOf(ValidationError);
  });
});

describe("buildScopedIdFilter", () => {
  test("emits a backtick-quoted id list", () => {
    expect(buildScopedIdFilter(["01A", "01B"])).toBe("id:=[`01A`,`01B`]");
  });

  test("refuses an empty scope (route-layer must handle empty → 200)", () => {
    expect(() => buildScopedIdFilter([])).toThrow(/empty scope/);
  });

  test("strips backticks from input ids so they can't break out of the filter grammar", () => {
    expect(buildScopedIdFilter(["evil`id"])).toBe("id:=[`evilid`]");
  });
});
