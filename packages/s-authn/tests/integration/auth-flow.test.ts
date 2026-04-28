import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type JwtStub,
  type LocalDynamo,
  createStubAuthzView,
  createTable,
  invoke,
  startJwtStub,
  startLocalDynamo,
} from "@s/shared/testing";

const AUTHN_USERS_TABLE = "AuthnUsers-test";
const AUTHN_REFRESH_TOKENS_TABLE = "AuthnRefreshTokens-test";
const RATE_LIMITS_TABLE = "RateLimits-test";
const AUTHZ_VIEW_TABLE = "AuthzView-test";

let dynamo: LocalDynamo;
let jwt: JwtStub;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported Hono app
let app: any;

beforeAll(async () => {
  dynamo = await startLocalDynamo();
  jwt = await startJwtStub();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.AUTHN_USERS_TABLE_NAME = AUTHN_USERS_TABLE;
  process.env.AUTHN_REFRESH_TOKENS_TABLE_NAME = AUTHN_REFRESH_TOKENS_TABLE;
  process.env.RATE_LIMITS_TABLE_NAME = RATE_LIMITS_TABLE;
  process.env.AUTHZ_VIEW_TABLE_NAME = AUTHZ_VIEW_TABLE;
  process.env.AUTHN_URL = jwt.baseUrl;
  process.env.JWT_ISSUER = "s-authn";
  process.env.JWT_AUDIENCE = "s-platform";
  // Not used by the test (test swaps the signer), but required to pass
  // the env-var existence check in token.service.ts on module load.
  process.env.KMS_KEY_ALIAS = "alias/s-authn-jwt-test";

  await createTable(dynamo.endpoint, {
    tableName: AUTHN_USERS_TABLE,
    partitionKey: "id",
    indexes: [{ indexName: "ByEmail", partitionKey: "email" }],
  });
  await createTable(dynamo.endpoint, {
    tableName: AUTHN_REFRESH_TOKENS_TABLE,
    partitionKey: "id",
    indexes: [
      {
        indexName: "ByUserId",
        partitionKey: "userId",
        sortKey: "createdAt",
      },
    ],
  });
  await createTable(dynamo.endpoint, {
    tableName: RATE_LIMITS_TABLE,
    partitionKey: "key",
  });
  await createStubAuthzView(dynamo.endpoint, AUTHZ_VIEW_TABLE);

  // Swap s-authn's KMS-backed signer for our JWT stub's local RSA signer.
  // Tokens issued by register/login/refresh will be verifiable by the
  // stub's JWKS endpoint (which is what shared/auth/verify.ts fetches).
  const tokenService = await import("@s-authn/core/tokens/token.service");
  tokenService.__setSignJwtForTests((payload, expiresInSeconds) =>
    jwt.signPayload(payload, expiresInSeconds),
  );
  tokenService.__setJwksProviderForTests(async () => ({
    // biome-ignore lint/suspicious/noExplicitAny: JWKS type lives in s-authn
    keys: jwt.getJwks().keys as any,
  }));

  const api = await import("@s-authn/functions/api");
  app = api.default;
});

afterAll(async () => {
  const tokenService = await import("@s-authn/core/tokens/token.service");
  tokenService.__setSignJwtForTests(null);
  tokenService.__setJwksProviderForTests(null);
  await jwt.stop();
  await dynamo.stop();
});

describe("s-authn auth flow (integration)", () => {
  test("GET /authn/health is public", async () => {
    const res = await invoke(app, "/authn/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("GET /authn/auth/jwks returns keys", async () => {
    const res = await invoke<{ keys: Array<{ kid: string }> }>(app, "/authn/auth/jwks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys.length).toBeGreaterThan(0);
  });

  test("register → login → refresh flow", async () => {
    const email = `alice+${Date.now()}@example.com`;
    const password = "Sup3rSecret!pw";

    // 1. Register
    const regRes = await invoke(app, "/authn/auth/register", {
      method: "POST",
      body: { email, password },
    });
    expect(regRes.status).toBe(201);
    // Generic success: empty body
    expect(regRes.body).toBe("");

    // 2. Re-register same email → still 201 (avoid enumeration)
    const dup = await invoke(app, "/authn/auth/register", {
      method: "POST",
      body: { email, password },
    });
    expect(dup.status).toBe(201);
    expect(dup.body).toBe("");

    // 3. Login with correct credentials
    const loginRes = await invoke<{
      data: { accessToken: string; refreshToken: string };
    }>(app, "/authn/auth/login", {
      method: "POST",
      body: { email, password },
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.accessToken.split(".")).toHaveLength(3);
    const refreshToken = loginRes.body.data.refreshToken;

    // 4. Login with wrong password → 401
    const badLogin = await invoke(app, "/authn/auth/login", {
      method: "POST",
      body: { email, password: "wrong-password" },
    });
    expect(badLogin.status).toBe(401);

    // 5. Refresh
    const refreshRes = await invoke<{ data: { accessToken: string; refreshToken: string } }>(
      app,
      "/authn/auth/token/refresh",
      { method: "POST", body: { refreshToken } },
    );
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken.split(".")).toHaveLength(3);
    expect(refreshRes.body.data.refreshToken.split(".")).toHaveLength(3);

    const refreshToken2 = refreshRes.body.data.refreshToken;
    expect(refreshToken2).not.toEqual(refreshToken);

    // 6. Refreshing with the old token again should fail
    const refreshResOld = await invoke(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    expect(refreshResOld.status).toBe(401);

    // 7. Refreshing with the new token should succeed
    const refreshRes2 = await invoke<{ data: { accessToken: string; refreshToken: string } }>(
      app,
      "/authn/auth/token/refresh",
      { method: "POST", body: { refreshToken: refreshToken2 } },
    );
    expect(refreshRes2.status).toBe(200);
    expect(refreshRes2.body.data.accessToken.split(".")).toHaveLength(3);
    expect(refreshRes2.body.data.refreshToken.split(".")).toHaveLength(3);
  });

  test("POST /authn/auth/token/refresh with malformed tokens", async () => {
    // 1. Not three parts
    const res1 = await invoke(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken: "not.a.jwt" },
    });
    expect(res1.status).toBe(401);
    expect(res1.body).toEqual({
      error: {
        code: "REFRESH_TOKEN_MALFORMED",
        message: "Refresh token is malformed",
        details: null,
      },
    });

    // 2. Invalid base64/JSON in payload
    const res2 = await invoke(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken: "header.invalid-payload.signature" },
    });
    expect(res2.status).toBe(401);
    expect(res2.body).toEqual({
      error: {
        code: "REFRESH_TOKEN_MALFORMED",
        message: "Refresh token is malformed",
        details: null,
      },
    });

    // 3. Valid JSON but missing required fields
    const payload = Buffer.from(JSON.stringify({ some: "field" })).toString("base64url");
    const res3 = await invoke(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken: `header.${payload}.signature` },
    });
    expect(res3.status).toBe(401);
    expect(res3.body).toEqual({
      error: {
        code: "REFRESH_TOKEN_MALFORMED",
        message: "Refresh token is malformed",
        details: null,
      },
    });

    // 4. Required fields must be strings, not merely truthy values
    const nonStringClaims = Buffer.from(JSON.stringify({ sub: {}, jti: [] })).toString("base64url");
    const res4 = await invoke(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken: `header.${nonStringClaims}.signature` },
    });
    expect(res4.status).toBe(401);
    expect(res4.body).toEqual({
      error: {
        code: "REFRESH_TOKEN_MALFORMED",
        message: "Refresh token is malformed",
        details: null,
      },
    });
  });

  test("register rate limiting", async () => {
    const email = `ratelimit+${Date.now()}@example.com`;
    const password = "Password123!";
    const testIp = `1.2.3.${Date.now() % 255}`;

    // Limit is 5 per minute. First 5 should succeed.
    for (let i = 0; i < 5; i++) {
      const res = await invoke(app, "/authn/auth/register", {
        method: "POST",
        headers: { "x-forwarded-for": testIp },
        body: { email: `${i}_${email}`, password },
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe((4 - i).toString());
    }

    // 6th should fail with 429
    const res6 = await invoke(app, "/authn/auth/register", {
      method: "POST",
      headers: { "x-forwarded-for": testIp },
      body: { email: `6_${email}`, password },
    });
    expect(res6.status).toBe(429);
    expect(res6.body).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
        details: null,
      },
    });
    expect(res6.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});

describe("/authn/user/sessions:revoke — AIP-136 custom action", () => {
  test("direct POST to /_actions/revoke returns 404 (internal path is not publicly routable)", async () => {
    // The `:verb` rewrite is the only supported ingress. A caller who
    // tries to address the internal path directly must not reach the
    // handler — this test pins that guarantee.
    const res = await invoke(app, "/authn/user/sessions/_actions/revoke", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("POST /authn/user/sessions:revoke missing X-Refresh-JTI returns 400", async () => {
    // Requires a valid access token to pass middleware
    const email = `bob+${Date.now()}@example.com`;
    const password = "Password123!";
    await invoke(app, "/authn/auth/register", {
      method: "POST",
      body: { email, password },
    });

    const loginRes = await invoke<{
      data: { accessToken: string };
    }>(app, "/authn/auth/login", {
      method: "POST",
      body: { email, password },
    });
    const accessToken = loginRes.body.data.accessToken;

    const res = await invoke(app, "/authn/user/sessions:revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "MISSING_REFRESH_JTI",
        message: "X-Refresh-JTI header required for logout",
        details: null,
      },
    });
  });
});
