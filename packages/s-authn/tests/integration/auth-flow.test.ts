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
    const regRes = await invoke<{
      data: { accessToken: string; refreshToken: string };
    }>(app, "/authn/auth/register", {
      method: "POST",
      body: { email, password },
    });
    expect(regRes.status).toBe(201);
    expect(regRes.body.data.accessToken.split(".")).toHaveLength(3);
    expect(regRes.body.data.refreshToken.split(".")).toHaveLength(3);

    // 2. Re-register same email → 409
    const dup = await invoke(app, "/authn/auth/register", {
      method: "POST",
      body: { email, password },
    });
    expect(dup.status).toBe(409);

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
    const refreshRes = await invoke<{
      data: { accessToken: string; refreshToken: string };
    }>(app, "/authn/auth/token/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken.split(".")).toHaveLength(3);
    expect(refreshRes.body.data.refreshToken.split(".")).toHaveLength(3);
    expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);
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
});
