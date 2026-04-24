import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { changePassword } from "@s-authn/core/auth/auth.service";
import { authMiddleware } from "@s/shared/auth";
import { requireSuperadmin } from "../_access";
import { ChangePasswordBody } from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// All routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// PATCH /users/me/password - Change caller's own password
user.openapi(
  createRoute({
    method: "patch",
    path: "/users/me/password",
    tags: ["User"],
    summary: "Change the caller's password",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: { "application/json": { schema: ChangePasswordBody } },
        required: true,
      },
    },
    responses: {
      204: { description: "Password changed" },
      401: { description: "Current password incorrect" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const body = c.req.valid("json");
    await changePassword({
      userId: caller.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return c.body(null, 204);
  },
);

// PATCH /users/{id}/password - Change any user's password (admin)
// Requires user_superadmin permission
user.openapi(
  createRoute({
    method: "patch",
    path: "/users/{id}/password",
    tags: ["User Admin"],
    summary: "Change any user's password (admin)",
    description: "Requires `user_superadmin` permission.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: { "application/json": { schema: z.object({ newPassword: z.string().min(1) }) } },
        required: true,
      },
    },
    responses: {
      204: { description: "Password changed" },
      403: { description: "Missing user_superadmin permission" },
      404: { description: "User not found" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    requireSuperadmin(caller);

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    await changePassword({
      userId: id,
      currentPassword: "", // Admin doesn't need current password
      newPassword: body.newPassword,
    });
    return c.body(null, 204);
  },
);

// Legacy routes with deprecation headers

const deprecatedUser = new OpenAPIHono<AppEnv>();

// Deprecation headers middleware
deprecatedUser.use("*", async (c, next) => {
  await next();
  const sunsetDate = new Date();
  sunsetDate.setDate(sunsetDate.getDate() + 42);
  c.header("Deprecation", "true");
  c.header("Sunset", sunsetDate.toUTCString());
});

// PATCH /me/password - LEGACY: Change caller's own password
deprecatedUser.openapi(
  createRoute({
    method: "patch",
    path: "/me/password",
    tags: ["User (DEPRECATED)"],
    summary: "Change the caller's password (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `PATCH /authn/user/users/me/password` instead.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: { "application/json": { schema: ChangePasswordBody } },
        required: true,
      },
    },
    responses: {
      204: { description: "Password changed" },
      401: { description: "Current password incorrect" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const body = c.req.valid("json");
    await changePassword({
      userId: caller.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return c.body(null, 204);
  },
);

export default user;
export { deprecatedUser };
