import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { changePassword, logout } from "@s-authn/core/auth/auth.service";
import { authMiddleware } from "@s/shared/auth";
import { ChangePasswordBody } from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// All /user routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// POST /user/me/logout
user.openapi(
  createRoute({
    method: "post",
    path: "/me/logout",
    tags: ["User"],
    summary: "Revoke the caller's refresh token",
    security: [{ Bearer: [] }],
    responses: {
      204: { description: "Logged out" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    // Client sends refresh token jti via header to avoid needing it in the body
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

// PATCH /user/me/password
user.openapi(
  createRoute({
    method: "patch",
    path: "/me/password",
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

export default user;
