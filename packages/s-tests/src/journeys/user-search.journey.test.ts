import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TestHttpError, createTestClient } from "../client";
import { clearAuthzPermissions, seedAuthzPermissions } from "../helpers/authz-seed";
import { eventually } from "../helpers/eventually";
import "../setup";

/**
 * User search journey — end-to-end against the Typesense-backed
 * `GET /user/admin/users` endpoint.
 *
 * Flow:
 *   1. Register a user (via s-authn) → profile auto-provisioned (s-user
 *      `user.registered` handler).
 *   2. Grant `user_superadmin` via the AuthzView seeder; re-login to get
 *      a token whose claims carry the permission.
 *   3. /user/info reports typesense probe up.
 *   4. Wait for the search indexer to consume `user.profile.created`
 *      and upsert the document.
 *   5. Update the profile (PATCH /user/user/users/me) → search reflects
 *      the new first name.
 *   6. Page-based pagination + cursor + bad-sort 400.
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

  afterAll(async () => {
    if (callerId) {
      await clearAuthzPermissions(callerId).catch(() => {
        // best effort — stage cleanup shouldn't fail the journey
      });
    }
  });

  test("[0] register → grant user_superadmin → re-login", async () => {
    // Since #121, register returns 201 with no body — login is required to
    // obtain tokens.
    const registerRes = await client.request("POST", "/authn/auth/register", {
      body: { email, password },
    });
    expect(registerRes).toBeNull();

    const initialLogin = await client.request<{
      data: { accessToken: string };
    }>("POST", "/authn/auth/login", { body: { email, password } });
    expect(initialLogin.data.accessToken).toBeDefined();

    // Extract userId from JWT sub so we can seed permissions for it.
    const payloadB64 = initialLogin.data.accessToken.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      sub: string;
    };
    callerId = payload.sub;

    await seedAuthzPermissions(callerId, [{ id: "user_superadmin" }]);

    // Re-login so the new token's claims embed user_superadmin.
    const login = await client.request<{ data: { accessToken: string } }>(
      "POST",
      "/authn/auth/login",
      { body: { email, password } },
    );
    accessToken = login.data.accessToken;
    client.setToken(accessToken);
  });

  test("[1] /user/info — typesense probe reports up", async () => {
    const info = await client.request<{
      data: { probes?: { typesense?: { status: string; detail?: string } } };
    }>("GET", "/user/info");
    expect(info.data.probes?.typesense?.status).toBe("up");
  });

  test("[2] caller's profile eventually indexed in search", async () => {
    // AuthzView propagation — first authenticated admin call may land on
    // a Lambda container whose cache still has empty permissions. Retry
    // until 200 and the caller's userId is present in the index.
    await eventually(
      async () => {
        const res = await client.request<{
          data: Array<{ id: string }>;
          meta: { found: number };
        }>("GET", "/user/admin/users?per_page=100");
        expect(res.data.some((h) => h.id === callerId)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[3] PATCH /user/user/users/me → search reflects new first name", async () => {
    const firstName = `Searchable${suffix.slice(0, 6)}`;
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
        expect(res.data.some((h) => h.firstName === firstName)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );
  });

  test("[4] page-based pagination returns consistent totals", async () => {
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
      meta: { found: number; nextCursor?: string };
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
});
