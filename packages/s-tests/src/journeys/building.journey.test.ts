import { afterAll, describe, expect, test } from "bun:test";
import { TestHttpError, createTestClient } from "../client";
import { clearAuthzPermissions, seedAuthzPermissions } from "../helpers/authz-seed";
import { eventually } from "../helpers/eventually";
import "../setup";

/**
 * Building journey — end-to-end per-role access matrix.
 *
 * Three users, three roles, two buildings:
 *
 *   super-user    → building-superadmin (global)
 *   admin-user    → building-admin scoped to [A]
 *   member-user   → building-user scoped to [A, B]
 *
 *   A — active (superadmin creates + activates)
 *   B — draft  (superadmin creates, leaves in draft)
 *
 * Permissions are seeded directly into `AuthzView` via the SSM-resolved
 * table name — s-authz has no admin user in dev, and `AuthzView` is the
 * materialized view every module's auth middleware reads anyway.
 *
 * The middleware caches permissions per token for up to 60s (dev TTL).
 * After seeding, each user logs in again to pick up a fresh cache
 * entry. The 1s AuthzView-propagation retry pattern from #35 is applied
 * around the first authenticated request of each user.
 *
 * Runs against a deployed stage (`STAGE=dev` by default). Requires:
 *   - AWS credentials in scope for DDB + SSM on the target account
 *   - Typesense stage params seeded (for the user-audience list tests)
 */
describe("building journey", () => {
  const client = createTestClient();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const passwords = {
    super: "SuperJourney1234!",
    admin: "AdminJourney1234!",
    member: "MemberJourney1234!",
  };
  const emails = {
    super: `building-super-${suffix}@example.com`,
    admin: `building-admin-${suffix}@example.com`,
    member: `building-member-${suffix}@example.com`,
  };

  const ids: { super?: string; admin?: string; member?: string } = {};
  const tokens: { super?: string; admin?: string; member?: string } = {};

  let buildingA: string | undefined;
  let buildingB: string | undefined;

  // ─── Setup ─────────────────────────────────────────────────────────────────

  test("[0] register three users", async () => {
    // Since #121, register returns 201 with no body — login is required to
    // obtain tokens. Userid is extracted from the login token's `sub` claim.
    for (const role of ["super", "admin", "member"] as const) {
      const registerRes = await client.request("POST", "/authn/auth/register", {
        body: { email: emails[role], password: passwords[role] },
      });
      expect(registerRes).toBeNull();

      const login = await client.request<{
        data: { accessToken: string };
      }>("POST", "/authn/auth/login", {
        body: { email: emails[role], password: passwords[role] },
      });
      const token = login.data.accessToken;
      const payloadB64 = token.split(".")[1];
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
        sub: string;
      };
      ids[role] = payload.sub;
    }
    expect(ids.super).toBeDefined();
    expect(ids.admin).toBeDefined();
    expect(ids.member).toBeDefined();
  });

  test("[1] seed AuthzView with per-user role templates", async () => {
    // The building_superadmin role is a single global permission. The
    // other three are scope-required; the assignment's `value` is the
    // list of building ids they cover. We seed `*BUILDING` placeholder
    // strings here and then rewrite the scope once the buildings exist
    // in [2] — the admin/member scope lists can't be known until A and
    // B get ULIDs from the server.
    //
    // Between now and [2], admin-user and member-user will carry empty
    // scopes — tests that rely on scoped access are gated after the
    // re-seed below.
    await seedAuthzPermissions(required(ids.super, "super id"), [{ id: "building_superadmin" }]);
    await seedAuthzPermissions(required(ids.admin, "admin id"), [
      { id: "building_admin", value: [] },
    ]);
    await seedAuthzPermissions(required(ids.member, "member id"), [
      { id: "building_user", value: [] },
    ]);
  });

  test("[2] login each user to get a fresh token (post-seed cache miss)", async () => {
    for (const role of ["super", "admin", "member"] as const) {
      const res = await client.request<{
        data: { accessToken: string };
      }>("POST", "/authn/auth/login", {
        body: { email: emails[role], password: passwords[role] },
      });
      tokens[role] = res.data.accessToken;
    }
    expect(tokens.super).toBeDefined();
  });

  // ─── Superadmin flow ───────────────────────────────────────────────────────

  test("[3] superadmin creates building A and activates it", async () => {
    client.setToken(tokens.super);
    // AuthzView propagation — the first authenticated call after seeding
    // can land on a Lambda container whose cache still has stale
    // (empty) permissions. Retry until the first call succeeds.
    let created: { data: { buildingId: string; status: string } } | undefined;
    await eventually(
      async () => {
        const res = await client.request<{
          data: { buildingId: string; status: string };
        }>("POST", "/building/admin/buildings", {
          body: fixtureBody("A"),
        });
        expect(res.data.buildingId).toBeDefined();
        created = res;
      },
      { timeout: 30_000, interval: 1_000 },
    );
    buildingA = created?.data.buildingId;
    expect(buildingA).toBeDefined();

    const activated = await client.request<{ data: { status: string } }>(
      "POST",
      `/building/admin/buildings/${buildingA}:activate`,
    );
    expect(activated.data.status).toBe("active");
  });

  test("[4] superadmin creates building B (stays draft)", async () => {
    client.setToken(tokens.super);
    const res = await client.request<{
      data: { buildingId: string; status: string };
    }>("POST", "/building/admin/buildings", { body: fixtureBody("B") });
    buildingB = res.data.buildingId;
    expect(res.data.status).toBe("draft");
  });

  test("[5] re-seed admin + member with real building ids", async () => {
    // Now that A and B exist, rewrite the scope arrays. Admin gets
    // scope over A only; member gets scope over A + B.
    const a = required(buildingA, "buildingA");
    const b = required(buildingB, "buildingB");
    await seedAuthzPermissions(required(ids.admin, "admin id"), [
      { id: "building_admin", value: [a] },
    ]);
    await seedAuthzPermissions(required(ids.member, "member id"), [
      { id: "building_user", value: [a, b] },
    ]);
  });

  // ─── Admin-user flow ───────────────────────────────────────────────────────

  test("[6] admin-user lists — sees only A", async () => {
    client.setToken(tokens.admin);
    let response: { data: Array<{ id: string }> } | undefined;
    await eventually(
      async () => {
        const r = await client.request<{
          data: Array<{ id: string }>;
        }>("GET", "/building/admin/buildings");
        expect(r.data.some((b) => b.id === buildingA)).toBe(true);
        response = r;
      },
      { timeout: 30_000, interval: 1_000 },
    );
    expect(response?.data.some((b) => b.id === buildingB)).toBe(false);
  });

  test("[6a] admin-user search filters cannot escape scope", async () => {
    client.setToken(tokens.super);
    await eventually(
      async () => {
        const r = await client.request<{
          data: Array<{ id: string }>;
        }>("GET", "/building/admin/buildings");
        expect(r.data.some((b) => b.id === buildingA)).toBe(true);
        expect(r.data.some((b) => b.id === buildingB)).toBe(true);
      },
      { timeout: 45_000, interval: 1_000 },
    );

    client.setToken(tokens.admin);
    const all = await client.request<{ data: Array<{ id: string }> }>(
      "GET",
      "/building/admin/buildings?q=*",
    );
    expect(all.data.some((b) => b.id === buildingA)).toBe(true);
    expect(all.data.some((b) => b.id === buildingB)).toBe(false);

    const narrowedAway = await client.request<{ data: Array<{ id: string }> }>(
      "GET",
      `/building/admin/buildings?filter_by=${encodeURIComponent(`id:!=${buildingA}`)}`,
    );
    expect(narrowedAway.data).toEqual([]);

    await expectHttpError(
      () =>
        client.request(
          "GET",
          `/building/admin/buildings?filter_by=${encodeURIComponent("status:=draft || status:=active")}`,
        ),
      400,
    );
  });

  test("[7] admin-user GET /{B} → 403 (not in scope)", async () => {
    client.setToken(tokens.admin);
    await expectHttpError(
      () => client.request("GET", `/building/admin/buildings/${buildingB}`),
      403,
    );
  });

  test("[8] admin-user PATCH /{A} → 200", async () => {
    client.setToken(tokens.admin);
    const res = await client.request<{ data: { name: string } }>(
      "PATCH",
      `/building/admin/buildings/${buildingA}`,
      { body: { name: `Building A (journey ${suffix})` } },
    );
    expect(res.data.name).toContain("Building A");
  });

  test("[9] admin-user DELETE /{A} → 204; re-create A as superadmin for the member flow", async () => {
    client.setToken(tokens.admin);
    await client.request("DELETE", `/building/admin/buildings/${buildingA}`);

    // Re-create A so step [10]+ can still see an active building in
    // member-user's scope. Use the same placeholder name — the new
    // row gets a fresh ULID, so we update the scope seeds to match.
    client.setToken(tokens.super);
    const recreated = await client.request<{
      data: { buildingId: string };
    }>("POST", "/building/admin/buildings", { body: fixtureBody("A") });
    const newA = recreated.data.buildingId;
    await client.request("POST", `/building/admin/buildings/${newA}:activate`);
    buildingA = newA;

    // Re-seed member so their scope covers the recreated A.
    await seedAuthzPermissions(required(ids.member, "member id"), [
      {
        id: "building_user",
        value: [required(buildingA, "buildingA"), required(buildingB, "buildingB")],
      },
    ]);

    // Fresh login for member — their existing tokens.member was minted
    // in [2] with empty scope, and any Lambda container that has
    // since cached it still has the stale (old or missing A) scope.
    // Caching is per-token, so a new token guarantees the next call
    // re-reads AuthzView. Without this the 45s indexer-wait in [10]
    // can silently absorb a cache-miss retry and miss the window.
    const loginRes = await client.request<{
      data: { accessToken: string };
    }>("POST", "/authn/auth/login", {
      body: { email: emails.member, password: passwords.member },
    });
    tokens.member = loginRes.data.accessToken;
  });

  // ─── Member-user flow ──────────────────────────────────────────────────────

  test("[10] member-user /user/buildings — sees A only (B is draft → filtered)", async () => {
    client.setToken(tokens.member);
    // Wait for Typesense indexer to catch up with the recreated A.
    // The indexer consumes building.created + building.activated off
    // the bus; on a cold-chain deploy this can take 5-10s.
    let response: { data: Array<{ id: string; status: string }> } | undefined;
    await eventually(
      async () => {
        const r = await client.request<{
          data: Array<{ id: string; status: string }>;
        }>("GET", "/building/user/buildings");
        expect(r.data.some((b) => b.id === buildingA)).toBe(true);
        response = r;
      },
      { timeout: 45_000, interval: 1_000 },
    );
    expect(response?.data.every((b) => b.status === "active")).toBe(true);
    expect(response?.data.some((b) => b.id === buildingB)).toBe(false);
  });

  test("[11] member-user GET /user/buildings/{A} → 200", async () => {
    client.setToken(tokens.member);
    const res = await client.request<{ data: { buildingId: string; status: string } }>(
      "GET",
      `/building/user/buildings/${buildingA}`,
    );
    expect(res.data.buildingId).toBe(buildingA as string);
    expect(res.data.status).toBe("active");
  });

  test("[12] member-user GET /user/buildings/{B} → 404 (draft, not active)", async () => {
    client.setToken(tokens.member);
    await expectHttpError(
      () => client.request("GET", `/building/user/buildings/${buildingB}`),
      404,
    );
  });

  test("[13] member-user GET /admin/buildings → 200 with empty list (no admin/manager scope)", async () => {
    client.setToken(tokens.member);
    const res = await client.request<{
      data: unknown[];
      meta: { found: number };
    }>("GET", "/building/admin/buildings");
    // member has building_user only — the admin list gates on
    // building_admin / building_manager / building_superadmin, none of
    // which member holds. Empty-scope short-circuit returns 200 with
    // an empty data array; it is NOT a 403 on this module (mirrors the
    // rule for the empty admin/manager scope case).
    expect(res.data).toEqual([]);
    expect(res.meta.found).toBe(0);
  });

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  afterAll(async () => {
    // Best-effort: delete any remaining buildings (superadmin only).
    client.setToken(tokens.super);
    for (const id of [buildingA, buildingB]) {
      if (!id) continue;
      try {
        await client.request("DELETE", `/building/admin/buildings/${id}`);
      } catch {
        // Already gone (e.g. A was deleted in step [9] and only the
        // recreated one exists) — ignore.
      }
    }

    // Drop the AuthzView entries so test users can't accumulate
    // permissions across repeat runs in the same stage.
    for (const userId of Object.values(ids)) {
      if (!userId) continue;
      try {
        await clearAuthzPermissions(userId);
      } catch {
        // Permission-table teardown is best-effort; a residual row is
        // harmless — the test users have no valid password for anyone
        // to reuse anyway.
      }
    }
  });
});

/**
 * Minimum viable building POST body. Unique name per building label
 * keeps the recreated-A case distinguishable in logs.
 */
function fixtureBody(label: string) {
  return {
    name: `Journey Building ${label}`,
    description: `Building ${label} from the e2e journey`,
    address: {
      formatted: "1 Journey St, Praha, CZ",
      streetAddress: "1 Journey St",
      locality: "Praha",
      countryCode: "CZ",
    },
    areaSqm: 1000,
    population: 50,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "EUR",
    timezone: "Europe/Prague",
  };
}

async function expectHttpError(fn: () => Promise<unknown>, status: number): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TestHttpError) {
      expect(err.status).toBe(status);
      return;
    }
    throw err;
  }
  throw new Error(`Expected HTTP ${status} but the call succeeded`);
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`journey invariant: ${label} is undefined`);
  return value;
}
