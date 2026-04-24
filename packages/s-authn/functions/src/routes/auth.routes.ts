import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { changePassword, login, logout, refresh, register } from "@s-authn/core/auth/auth.service";
import { getJwks } from "@s-authn/core/tokens/token.service";
import { authMiddleware } from "@s/shared/auth";
import {
  AccessTokenResponse,
  JwksResponse,
  LoginBody,
  RefreshTokenBody,
  RegisterBody,
  TokenResponse,
} from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const auth = new OpenAPIHono<AppEnv>();

// POST /register - Register a new user
auth.openapi(
  createRoute({
    method: "post",
    path: "/register",
    tags: ["Auth"],
    summary: "Register a new user",
    request: {
      body: { content: { "application/json": { schema: RegisterBody } }, required: true },
    },
    responses: {
      201: {
        content: { "application/json": { schema: TokenResponse } },
        description: "Registered",
      },
      409: { description: "Email already exists" },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const result = await register(body);
    return c.json({ data: result }, 201);
  },
);

// POST /login - Log in with email and password
auth.openapi(
  createRoute({
    method: "post",
    path: "/login",
    tags: ["Auth"],
    summary: "Log in with email and password",
    request: {
      body: { content: { "application/json": { schema: LoginBody } }, required: true },
    },
    responses: {
      200: { content: { "application/json": { schema: TokenResponse } }, description: "Logged in" },
      401: { description: "Invalid credentials" },
      403: { description: "Account disabled or password expired" },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const result = await login(body);
    return c.json({ data: result }, 200);
  },
);

// POST /token/refresh - Exchange refresh token for a new access token
auth.openapi(
  createRoute({
    method: "post",
    path: "/token/refresh",
    tags: ["Auth"],
    summary: "Exchange refresh token for a new access token",
    request: {
      body: { content: { "application/json": { schema: RefreshTokenBody } }, required: true },
    },
    responses: {
      200: {
        content: { "application/json": { schema: AccessTokenResponse } },
        description: "Token refreshed",
      },
      401: { description: "Refresh token invalid or expired" },
    },
  }),
  async (c) => {
    const { refreshToken: rawToken } = c.req.valid("json");
    const parts = rawToken.split(".");
    if (parts.length !== 3) {
      return c.json({ error: { code: "INVALID_FORMAT", message: "Malformed token" } }, 401);
    }
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString()) as {
      sub?: string;
      jti?: string;
    };
    if (!payload.sub || !payload.jti) {
      return c.json({ error: { code: "INVALID_FORMAT", message: "Missing sub or jti" } }, 401);
    }
    const result = await refresh({
      userId: payload.sub,
      tokenId: payload.jti,
      rawToken,
    });
    return c.json({ data: result }, 200);
  },
);

// GET /jwks - Public JWKS for verifying JWTs
auth.openapi(
  createRoute({
    method: "get",
    path: "/jwks",
    tags: ["Auth"],
    summary: "Public JWKS for verifying JWTs issued by this service",
    responses: {
      200: { content: { "application/json": { schema: JwksResponse } }, description: "JWKS" },
    },
  }),
  async (c) => {
    const jwks = await getJwks();
    return c.json(jwks, 200);
  },
);

// POST /sessions:revoke - Revoke a refresh token (AIP-136 custom action)
// The public URL is POST /authn/user/sessions:revoke
// Internally routed to /_actions/revoke via route rewrite (see api.ts)
auth.openapi(
  createRoute({
    method: "post",
    path: "/sessions/_actions/revoke",
    tags: ["Session"],
    summary: "Revoke refresh tokens (AIP-136 custom action)",
    description:
      "Revoke refresh tokens for the caller. The public URL is `POST /authn/user/sessions:revoke`.\n" +
      "This uses the AIP-136 workaround where colon-prefixed actions are rewritten to `/_actions/{verb}`.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              tokenIds: z.array(z.string()).optional(),
              all: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      204: { description: "Tokens revoked" },
      400: { description: "Invalid request" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const body = c.req.valid("json");

    let tokenId = c.req.header("x-refresh-jti");

    if (body.all) {
      return c.json(
        {
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Bulk token revocation not yet implemented",
          },
        },
        501,
      );
    }

    if (!tokenId && body.tokenIds && body.tokenIds.length > 0) {
      tokenId = body.tokenIds[0];
    }

    if (!tokenId) {
      return c.json(
        {
          error: {
            code: "MISSING_REFRESH_JTI",
            message: "X-Refresh-JTI header or tokenIds body required for logout",
          },
        },
        400,
      );
    }

    await logout({ userId: caller.userId, tokenId });
    return c.body(null, 204);
  },
);

// Legacy routes with deprecation headers - for backward compatibility during v1 retrofit

const deprecatedAuth = new OpenAPIHono<AppEnv>();

// Deprecation headers middleware
deprecatedAuth.use("*", async (c, next) => {
  await next();
  const sunsetDate = new Date();
  sunsetDate.setDate(sunsetDate.getDate() + 42);
  c.header("Deprecation", "true");
  c.header("Sunset", sunsetDate.toUTCString());
});

// POST /me/logout - LEGACY: Revoke caller's refresh token
deprecatedAuth.openapi(
  createRoute({
    method: "post",
    path: "/me/logout",
    tags: ["User (DEPRECATED)"],
    summary: "Revoke the caller's refresh token (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `POST /authn/user/sessions:revoke` instead.",
    security: [{ Bearer: [] }],
    responses: {
      204: { description: "Logged out" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const tokenId = c.req.header("x-refresh-jti");
    if (!tokenId) {
      return c.json(
        {
          error: {
            code: "MISSING_REFRESH_JTI",
            message: "X-Refresh-JTI header required for logout",
          },
        },
        400,
      );
    }
    await logout({ userId: caller.userId, tokenId });
    return c.body(null, 204);
  },
);

// Helper functions from core/auth/auth.service - imported above

export default auth;
export { deprecatedAuth };
