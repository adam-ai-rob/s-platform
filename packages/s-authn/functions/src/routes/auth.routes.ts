import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { login, refresh, register } from "@s-authn/core/auth/auth.service";
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

// GET /jwks
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

export default auth;
