import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getProfile, updateProfile } from "@s-user/core/profiles/profiles.service";
import { authMiddleware } from "@s/shared/auth";
import { requireSuperadmin } from "../_access";
import { ProfileResponse, UpdateProfileBody } from "../schemas/profile.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// All routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// GET /users/me - Get the caller's profile
user.openapi(
  createRoute({
    method: "get",
    path: "/users/me",
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

// PATCH /users/me - Update the caller's profile
user.openapi(
  createRoute({
    method: "patch",
    path: "/users/me",
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

// GET /users/{id} - Get any user's profile (admin)
// This route requires user_superadmin permission
user.openapi(
  createRoute({
    method: "get",
    path: "/users/{id}",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile (admin)",
    description: "Fetch a user profile by ID. Requires `user_superadmin` permission.",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      403: { description: "Missing user_superadmin permission" },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    requireSuperadmin(caller);
    const { id } = c.req.valid("param");
    const profile = await getProfile(id);
    return c.json({ data: profile }, 200);
  },
);

// Legacy routes with deprecation headers - v0 legacy paths for backward compatibility

const deprecatedUser = new OpenAPIHono<AppEnv>();

// Deprecation headers middleware
deprecatedUser.use("*", async (c, next) => {
  await next();
  const sunsetDate = new Date();
  sunsetDate.setDate(sunsetDate.getDate() + 42);
  c.header("Deprecation", "true");
  c.header("Sunset", sunsetDate.toUTCString());
});

// GET /me - LEGACY: Get the caller's profile
deprecatedUser.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["User (DEPRECATED)"],
    security: [{ Bearer: [] }],
    summary: "Get the caller's profile (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `GET /user/users/me` instead.",
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

// PATCH /me - LEGACY: Update the caller's profile
deprecatedUser.openapi(
  createRoute({
    method: "patch",
    path: "/me",
    tags: ["User (DEPRECATED)"],
    security: [{ Bearer: [] }],
    summary: "Update the caller's profile (partial) (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `PATCH /user/users/me` instead.",
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

// GET /{id} - LEGACY: Get any user's profile
deprecatedUser.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["User Admin (DEPRECATED)"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `GET /user/admin/users/{id}` instead, which requires `user_superadmin` permission.",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: { content: { "application/json": { schema: ProfileResponse } }, description: "Profile" },
      404: { description: "Profile not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const profile = await getProfile(id);
    return c.json({ data: profile }, 200);
  },
);

export default user;
export { deprecatedUser };
