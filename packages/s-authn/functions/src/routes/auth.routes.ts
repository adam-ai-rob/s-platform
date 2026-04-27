import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { login, refresh, register } from "@s-authn/core/auth/auth.service";
import { RefreshTokenMalformedError } from "@s-authn/core/shared/errors";
import { getJwks } from "@s-authn/core/tokens/token.service";
import {
  JwksResponse,
  LoginBody,
  RefreshTokenBody,
  RegisterBody,
  TokenResponse,
} from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const auth = new OpenAPIHono<AppEnv>();

// POST /register
auth.openapi(
  createRoute({
    method: "post",
    path: "/register",
    tags: ["Auth"],
    summary: "Register a new user",
    description:
      "Creates a new enabled user identity from an email and password, then returns an access token and refresh token. No bearer token is required. Returns 409 when the email is already registered.",
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

// POST /login
auth.openapi(
  createRoute({
    method: "post",
    path: "/login",
    tags: ["Auth"],
    summary: "Log in with email and password",
    description:
      "Authenticates an existing enabled user with email and password, then returns an access token and refresh token. No bearer token is required.",
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

// POST /token/refresh
auth.openapi(
  createRoute({
    method: "post",
    path: "/token/refresh",
    tags: ["Auth"],
    summary: "Rotate refresh token and return a new token pair",
    description:
      "Accepts a valid refresh token, revokes it, and returns a new access token and refresh token. The old refresh token cannot be reused after a successful rotation.",
    request: {
      body: { content: { "application/json": { schema: RefreshTokenBody } }, required: true },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TokenResponse } },
        description: "New access and refresh token pair",
      },
      401: { description: "Refresh token invalid or expired" },
    },
  }),
  async (c) => {
    const { refreshToken: rawToken } = c.req.valid("json");
    const payload = parseRefreshToken(rawToken);

    const result = await refresh({
      userId: payload.sub,
      tokenId: payload.jti,
      rawToken,
    });
    return c.json({ data: result }, 200);
  },
);

/**
 * Safely parses a refresh token payload without full cryptographic
 * verification (which is handled by the core service). This route-level
 * check ensures the token has the required fields to route the request.
 */
function parseRefreshToken(token: string): { sub: string; jti: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RefreshTokenMalformedError();
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString());
    if (!payload.sub || !payload.jti) {
      throw new RefreshTokenMalformedError();
    }
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    throw new RefreshTokenMalformedError();
  }
}

// GET /jwks
auth.openapi(
  createRoute({
    method: "get",
    path: "/jwks",
    tags: ["Auth"],
    summary: "JWKS for verifying JWTs issued by this service",
    description:
      "Returns the JSON Web Key Set used by clients and platform services to verify JWTs issued by s-authn. Publicly reachable; no authentication is required.",
    responses: {
      200: { content: { "application/json": { schema: JwksResponse } }, description: "JWKS" },
    },
  }),
  async (c) => {
    const jwks = await getJwks();
    return c.json(jwks, 200);
  },
);

export default auth;
