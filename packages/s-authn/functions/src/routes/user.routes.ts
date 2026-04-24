import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { changePassword, logout } from "@s-authn/core/auth/auth.service";
import { authMiddleware } from "@s/shared/auth";
import { ChangePasswordBody } from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// All /user routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// POST /authn/user/sessions:revoke
// Custom action per AIP-136. Routed internally at `/sessions/_actions/revoke`
// (see api.ts for the rewrite rationale). Public URL is the `:verb` form.
user.openapi(
  createRoute({
    method: "post",
    path: "/sessions/_actions/revoke",
    tags: ["User"],
    summary: "Revoke the caller's refresh token",
    description:
      "Public URL: `POST /authn/user/sessions:revoke`. The `_actions/` segment is a transport workaround — see `api.ts` for the rewrite.",
    security: [{ Bearer: [] }],
    responses: {
      204: { description: "Logged out" },
      400: { description: "Missing X-Refresh-JTI header" },
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

// PATCH /authn/user/users/me/password
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

export default user;
