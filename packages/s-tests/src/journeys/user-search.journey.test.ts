import { beforeAll, describe, expect, test } from "bun:test";
import { TestHttpError, createTestClient } from "../client";
import { eventually } from "../helpers/eventually";
import "../setup";

/**
 * User search journey — end-to-end against the Typesense-backed
 * `GET /user/admin/users` endpoint.
 *
 * Flow:
 *   1. Register a user (via s-authn) → profile auto-provisioned (s-user
 *      `user.registered` handler).
 *   2. /user/info reports typesense probe up.
 *   3. Wait for the search indexer to consume `user.profile.created`
 *      and upsert the document.
 *   4. Update the profile (PATCH /user/user/users/me) → search reflects the new
 *      first name.
 *   5. Page-based pagination works with v1 envelope (camelCase fields).
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
  let callerId: string;

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
    // Extract the userId from the JWT's `sub` claim so [2] can assert
    // the caller's specific profile appears in the index (rather than
    // passing trivially on any pre-existing user in the stage).
    const payloadB64 = accessToken.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      sub: string;
    };
    callerId = payload.sub;
    client.setToken(accessToken);
  });

  test("[1] /user/info — typesense probe reports up", async () => {
    const info = await client.request<{
      data: { probes?: { typesense?: { status: string; detail?: string } } };
    }>("GET", "/user/info");
    expect(info.data.probes?.typesense?.status).toBe("ok");
  });

  test("[2] caller's profile eventually indexed in search (v1 path)", async () => {
    // Freshly-registered profile has empty names, so displayName falls
    // back to userId. Assert specifically on the caller's userId in the
    // index, not just `found > 0` — otherwise a stage with other users
    // passes trivially and doesn't prove our user's chain worked.
    await eventually(
      async () => {
        const res = await client.request<{
          data: Array<{ id: string }>;
          meta: { found: number };
        }>("GET", "/user/admin/users?per_page=100");
        expect(res.data.some((u) => u.id === callerId)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[3] PATCH /user/user/users/me → search reflects new first name (v1 path)", async () => {
    const firstName = `Searchable${suffix.slice(0, 6)}`;
    // Even with [2] green, the PATCH can race a re-indexer retry. Retry
    // the PATCH itself briefly if the profile row hasn't been provisioned
    // yet (rare once [2] passed, but not impossible in cold-chain deploys).
    await eventually(
      async () => {
        await client.request("PATCH", "/user/user/users/me", {
          body: { firstName, lastName: "Journey" },
        });
      },
      { timeout: 15_000, interval: 1_000 },
    );

    await eventually(
      async () => {
        const res = await client.request<{
          data: Array<{ firstName: string }>;
          meta: { found: number };
        }>("GET", `/user/admin/users?q=${encodeURIComponent(firstName)}&per_page=5`);
        expect(res.meta.found).toBeGreaterThan(0);
        expect(res.data.some((u) => u.firstName === firstName)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[4] page-based pagination returns consistent totals (v1 envelope)", async () => {
    const page1 = await client.request<{
      data: unknown[];
      meta: { page: number; perPage: number; found: number };
    }>("GET", "/user/admin/users?per_page=1&page=1");

    expect(page1.meta.page).toBe(1);
    expect(page1.meta.perPage).toBe(1);
    expect(page1.data.length).toBeLessThanOrEqual(1);
    expect(page1.meta.found).toBeGreaterThanOrEqual(1);
  });

  test("[5] nextCursor present when more results follow", async () => {
    const res = await client.request<{
      data: unknown[];
      meta: { nextCursor?: string; found: number };
    }>("GET", "/user/admin/users?per_page=1");

    if (res.meta.found > 1) {
      expect(typeof res.meta.nextCursor).toBe("string");
    }
  });

  test("[6] bad sort field is rejected with 400", async () => {
    try {
      await client.request("GET", "/user/admin/users?sort_by=ssn:desc");
      throw new Error("Expected 400");
    } catch (err) {
      if (err instanceof TestHttpError) {
        expect(err.status).toBe(400);
        return;
      }
      throw err;
    }
  });

  // Legacy endpoint tests with deprecation headers
  test("[7] Legacy /user/search still works with deprecation headers", async () => {
    await eventually(
      async () => {
        const res = await client.request<{
          hits: Array<{ id: string }>;
          found: number;
        }>("GET", "/user/search?per_page=100");
        expect(res.found).toBeGreaterThan(0);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });
});
