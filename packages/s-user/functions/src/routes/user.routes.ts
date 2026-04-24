import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getProfile, updateProfile } from "@s-user/core/profiles/profiles.service";
import { authMiddleware } from "@s/shared/auth";
import { ForbiddenError } from "@s/shared/errors";
import type { Context } from "hono";
import { ProfileResponse, UpdateProfileBody } from "../schemas/profile.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();
const LEGACY_SUNSET = "Fri, 01 May 2026 00:00:00 GMT";

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

function markLegacy(c: Context<AppEnv>): void {
  c.header("Deprecation", "true");
  c.header("Sunset", LEGACY_SUNSET);
}

function requireUserSuperadmin(c: Context<AppEnv>): void {
  const caller = c.get("user");
  const allowed =
    caller.system === true || caller.permissions.some((p) => p.id === "user_superadmin");
  if (!allowed) throw new ForbiddenError("Missing permission: user_superadmin");
}

// GET /user/user/users/me
user.openapi(
  createRoute({
    method: "get",
    path: "/user/users/me",
    tags: ["User"],
    security: [{ Bearer: [] }],
    summary: "Get the caller's profile",
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      404: { description: "Profile not yet provisioned" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const profile = await getProfile(caller.userId);
    return c.json({ data: profile }, 200);
  },
);

// PATCH /user/user/users/me
user.openapi(
  createRoute({
    method: "patch",
    path: "/user/users/me",
    tags: ["User"],
    security: [{ Bearer: [] }],
    summary: "Update the caller's profile (partial)",
    request: {
      body: { content: { "application/json": { schema: UpdateProfileBody } }, required: true },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ProfileResponse } },
        description: "Updated profile",
      },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const body = c.req.valid("json");
    const updated = await updateProfile(caller.userId, body);
    return c.json({ data: updated }, 200);
  },
);

// GET /user/admin/users/{id}
user.openapi(
  createRoute({
    method: "get",
    path: "/admin/users/{id}",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile",
    description: "Requires `user_superadmin`.",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      403: { description: "Missing permission" },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    requireUserSuperadmin(c);
    const { id } = c.req.valid("param");
    const profile = await getProfile(id);
    return c.json({ data: profile }, 200);
  },
);

// Legacy GET /user/me
user.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["User Legacy"],
    security: [{ Bearer: [] }],
    summary: "Get the caller's profile (deprecated)",
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      404: { description: "Profile not yet provisioned" },
    },
  }),
  async (c) => {
    markLegacy(c);
    const caller = c.get("user");
    const profile = await getProfile(caller.userId);
    return c.json({ data: profile }, 200);
  },
);

// Legacy PATCH /user/me
user.openapi(
  createRoute({
    method: "patch",
    path: "/me",
    tags: ["User Legacy"],
    security: [{ Bearer: [] }],
    summary: "Update the caller's profile (deprecated)",
    request: {
      body: { content: { "application/json": { schema: UpdateProfileBody } }, required: true },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ProfileResponse } },
        description: "Updated profile",
      },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    markLegacy(c);
    const caller = c.get("user");
    const body = c.req.valid("json");
    const updated = await updateProfile(caller.userId, body);
    return c.json({ data: updated }, 200);
  },
);

// Legacy GET /user/{id}
user.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["User Legacy"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile (deprecated)",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    markLegacy(c);
    const { id } = c.req.valid("param");
    const profile = await getProfile(id);
    return c.json({ data: profile }, 200);
  },
);

export default user;
