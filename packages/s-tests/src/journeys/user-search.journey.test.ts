import { beforeAll, describe, expect, test } from "bun:test";
import { TestHttpError, createTestClient } from "../client";
import { eventually } from "../helpers/eventually";
import "../setup";

/**
 * User search journey — end-to-end against the Typesense-backed
 * `GET /user/search` endpoint.
 *
 * Flow:
 *   1. Register a user (via s-authn) → profile auto-provisioned (s-user
 *      `user.registered` handler).
 *   2. /user/info reports typesense probe up.
 *   3. Wait for the search indexer to consume `user.profile.created`
 *      and upsert the document.
 *   4. Update the profile (PATCH /user/me) → search reflects the new
 *      first name.
 *   5. Page-based pagination works; cursor is returned when a page is
 *      full.
 *   6. Bad sort fields are rejected with 400.
 *
 * The `user.profile.deleted` leg is skipped here because s-user has no
 * delete endpoint yet. When a deletion API lands we'll extend this
 * journey rather than write a new one.
 *
 * Pre-req: the target stage must have the Typesense SSM params seeded
 * (see `docs/runbooks/typesense-stage-bootstrap.md`). If not, /user/info
 * reports `typesense: { status: "down" }` and test [1] fails fast.
 */
describe("user search journey", () => {
  const client = createTestClient();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `search-test-${suffix}@example.com`;
  const password = "Initial1234!";

  let accessToken: string;

  beforeAll(() => {
    console.log(`  journey email: ${email}`);
  });

  test("[0] register → returns tokens", async () => {
    const res = await client.request<{
      data: { accessToken: string; refreshToken: string };
    }>("POST", "/authn/auth/register", {
      body: { email, password },
    });
    expect(res.data.accessToken).toBeDefined();
    accessToken = res.data.accessToken;
    client.setToken(accessToken);
  });

  test("[1] /user/info — typesense probe reports up", async () => {
    const info = await client.request<{
      data: { probes?: { typesense?: { status: string; detail?: string } } };
    }>("GET", "/user/info");
    expect(info.data.probes?.typesense?.status).toBe("up");
  });

  test("[2] profile eventually indexed in search", async () => {
    // Freshly-registered profile has empty names, so displayName falls
    // back to userId. Confirm the index grew by listing all docs.
    await eventually(
      async () => {
        const res = await client.request<{ found: number }>("GET", "/user/search?per_page=1");
        expect(res.found).toBeGreaterThan(0);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[3] PATCH /user/me → search reflects new first name", async () => {
    const firstName = `Searchable${suffix.slice(0, 6)}`;
    await client.request("PATCH", "/user/me", {
      body: { firstName, lastName: "Journey" },
    });

    await eventually(
      async () => {
        const res = await client.request<{
          hits: Array<{ firstName: string }>;
          found: number;
        }>("GET", `/user/search?q=${encodeURIComponent(firstName)}&per_page=5`);
        expect(res.found).toBeGreaterThan(0);
        expect(res.hits.some((h) => h.firstName === firstName)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[4] page-based pagination returns consistent totals", async () => {
    const page1 = await client.request<{
      hits: unknown[];
      page: number;
      per_page: number;
      found: number;
    }>("GET", "/user/search?per_page=1&page=1");

    expect(page1.page).toBe(1);
    expect(page1.per_page).toBe(1);
    expect(page1.hits.length).toBeLessThanOrEqual(1);
    expect(page1.found).toBeGreaterThanOrEqual(1);
  });

  test("[5] next_cursor present when more results follow", async () => {
    const res = await client.request<{
      hits: unknown[];
      next_cursor?: string;
      found: number;
    }>("GET", "/user/search?per_page=1");

    if (res.found > 1) {
      expect(typeof res.next_cursor).toBe("string");
    }
  });

  test("[6] bad sort field is rejected with 400", async () => {
    try {
      await client.request("GET", "/user/search?sort_by=ssn:desc,id:desc");
      throw new Error("Expected 400");
    } catch (err) {
      if (err instanceof TestHttpError) {
        expect(err.status).toBe(400);
        return;
      }
      throw err;
    }
  });
});
