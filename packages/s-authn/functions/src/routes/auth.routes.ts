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
    summary: "Exchange refresh token for a new access token",
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
    const result = await refresh({ rawToken });
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
