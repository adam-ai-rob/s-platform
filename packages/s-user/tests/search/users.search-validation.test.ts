import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { ValidationError } from "@s/shared/errors";
import { searchUsers } from "../../core/src/search/users.search";

/**
 * These tests only exercise the input-validation path of `searchUsers` —
 * validators run before the Typesense client is constructed, so a bad
 * input throws `ValidationError` without any network access.
 *
 * A real end-to-end test with a live cluster lives in the `s-tests`
 * journey suite.
 */

const originalStage = process.env.STAGE;

beforeAll(() => {
  process.env.STAGE = "test";
});

afterEach(() => {
  process.env.STAGE = originalStage;
});

describe("searchUsers input validation", () => {
  test("rejects sort field not on the whitelist", async () => {
    await expect(searchUsers({ sortBy: "ssn:desc,id:desc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("requires id as the final tiebreaker", async () => {
    await expect(searchUsers({ sortBy: "createdAtMs:desc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects non asc/desc direction", async () => {
    await expect(searchUsers({ sortBy: "createdAtMs:sideways,id:desc" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("rejects filter field not on the whitelist", async () => {
    await expect(searchUsers({ filterBy: "ssn:=1234" })).rejects.toBeInstanceOf(ValidationError);
  });
});
