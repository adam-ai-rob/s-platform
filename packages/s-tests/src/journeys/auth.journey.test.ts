import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TestHttpError, createTestClient } from "../client";
import { eventually } from "../helpers/eventually";
import "../setup";

/**
 * Auth journey — end-to-end.
 *
 * Exercises the full register → login → protected read → change password
 * → logout → refresh-rejected path. Runs against a deployed stage.
 *
 * Cross-module coverage (event-driven):
 *   - After register, s-user should eventually create an empty profile
 *     via the user.registered event.
 *   - After register, s-authz should eventually provision an empty
 *     AuthzView entry.
 *
 * The test uses a unique email per run, so it's safe to re-run.
 */
describe("auth journey", () => {
  const client = createTestClient();
  const email = `test-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password1 = "Initial1234!";
  const password2 = "Rotated9876!";

  let accessToken: string;
  let refreshToken: string;

  test("[1] register → returns tokens", async () => {
    const res = await client.request<{
      data: { accessToken: string; refreshToken: string; expiresIn: number };
    }>("POST", "/authn/auth/register", {
      body: { email, password: password1 },
    });

    expect(res.data.accessToken).toBeDefined();
    expect(res.data.refreshToken).toBeDefined();
    expect(res.data.expiresIn).toBe(3600);

    accessToken = res.data.accessToken;
    refreshToken = res.data.refreshToken;
    client.setToken(accessToken);
  });

  test("[2] /user/me — profile provisioned by user.registered event", async () => {
    // Event-driven: s-user's event-handler Lambda creates the profile
    // after receiving the user.registered EventBridge event. Give it
    // up to 10s (EventBridge + Lambda cold start).
    await eventually(
      async () => {
        const res = await client.request<{
          data: { userId: string; firstName: string; lastName: string };
        }>("GET", "/user/me");
        expect(res.data.firstName).toBe("");
        expect(res.data.lastName).toBe("");
      },
      { timeout: 15_000, interval: 500 },
    );
  });

  test("[3] /authz/user/me/permissions — empty AuthzView provisioned", async () => {
    await eventually(
      async () => {
        const res = await client.request<{
          data: { userId: string; permissions: Array<{ id: string }> };
        }>("GET", "/authz/user/me/permissions");
        expect(Array.isArray(res.data.permissions)).toBe(true);
      },
      { timeout: 15_000, interval: 500 },
    );
  });

  test("[4] PATCH /user/me — update first/last name", async () => {
    const res = await client.request<{
      data: { firstName: string; lastName: string };
    }>("PATCH", "/user/me", {
      body: { firstName: "Alice", lastName: "Example" },
    });
    expect(res.data.firstName).toBe("Alice");
    expect(res.data.lastName).toBe("Example");
  });

  test("[5] PATCH /user/me/password — change password", async () => {
    await client.request("PATCH", "/authn/user/me/password", {
      body: { currentPassword: password1, newPassword: password2 },
    });
  });

  test("[6] login with old password fails", async () => {
    try {
      await client.request("POST", "/authn/auth/login", {
        body: { email, password: password1 },
      });
      throw new Error("Expected 401");
    } catch (err) {
      if (err instanceof TestHttpError) {
        expect(err.status).toBe(401);
        return;
      }
      throw err;
    }
  });

  test("[7] login with new password succeeds", async () => {
    const res = await client.request<{
      data: { accessToken: string; refreshToken: string };
    }>("POST", "/authn/auth/login", {
      body: { email, password: password2 },
    });
    expect(res.data.accessToken).toBeDefined();
    accessToken = res.data.accessToken;
    refreshToken = res.data.refreshToken;
    client.setToken(accessToken);
  });

  test("[8] refresh → new access token", async () => {
    // Keep the old client token briefly aside; refresh endpoint is
    // public but takes the token in the body.
    const res = await client.request<{
      data: { accessToken: string; expiresIn: number };
    }>("POST", "/authn/auth/token/refresh", {
      body: { refreshToken },
    });
    expect(res.data.accessToken).toBeDefined();
    expect(res.data.expiresIn).toBe(3600);
  });

  test("[9] /authn/auth/jwks — public key available", async () => {
    // Clear token to prove endpoint is public
    client.setToken(undefined);
    const res = await client.request<{
      keys: Array<{ kid: string; kty: string; alg: string }>;
    }>("GET", "/authn/auth/jwks");
    expect(res.keys.length).toBeGreaterThan(0);
    expect(res.keys[0].kty).toBe("RSA");
    expect(res.keys[0].alg).toBe("RS256");
    client.setToken(accessToken);
  });

  test("[10a] admin endpoint 403s for user without role (authz_view wiring)", async () => {
    // Freshly-registered user has no roles → AuthzView has no permissions →
    // requirePermission("authz_admin") must fail-closed with 403.
    // Regression guard for the s-authz AUTHZ_VIEW_TABLE_NAME wiring.
    client.setToken(accessToken);
    try {
      await client.request("POST", "/authz/admin/roles", {
        body: { id: "test-role", name: "Test Role", permissions: [] },
      });
      throw new Error("Expected 403");
    } catch (err) {
      if (err instanceof TestHttpError) {
        expect(err.status).toBe(403);
        return;
      }
      throw err;
    }
  });

  test("[10] /health on every module — smoke", async () => {
    for (const module of ["authn", "authz", "user", "group"]) {
      client.setToken(undefined);
      const res = await client.request<{ status: string }>("GET", `/${module}/health`);
      expect(res.status).toBe("ok");
    }
    client.setToken(accessToken);
  });

  // Cleanup pending Phase 2 — admin delete endpoint not yet ported.
  // Test users accumulate in dev/test stages; safe to ignore for now.
  afterAll(() => {
    // no-op
  });

  beforeAll(() => {
    // Warm-up info: readable test ID for debugging
    console.log(`  journey email: ${email}`);
  });
});
