import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getProfile, updateProfile } from "@s-user/core/profiles/profiles.service";
import { authMiddleware } from "@s/shared/auth";
import { ProfileResponse, UpdateProfileBody } from "../schemas/profile.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// GET /user/me
user.openapi(
  createRoute({
    method: "get",
    path: "/me",
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

// PATCH /user/me
user.openapi(
  createRoute({
    method: "patch",
    path: "/me",
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

// GET /user/{id}
user.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["User"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile",
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
