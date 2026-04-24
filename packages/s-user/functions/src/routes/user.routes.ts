import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { getProfile, updateProfile } from "@s-user/core/profiles/profiles.service";
import { authMiddleware } from "@s/shared/auth";
import { ProfileResponse, UpdateProfileBody } from "../schemas/profile.schema";
import type { AppEnv } from "../types";

/**
 * User-audience routes for s-user. Mounted under `/user/user`.
 *
 * `/user/user/users/me` is the caller's own profile — self-access is
 * gated by the JWT alone, no permission check.
 */
const user = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

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

export default user;
