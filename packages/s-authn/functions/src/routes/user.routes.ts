import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { changePassword, logout } from "@s-authn/core/auth/auth.service";
import { MissingRefreshTokenIdError } from "@s-authn/core/shared/errors";
import { authMiddleware } from "@s/shared/auth";
import { ChangePasswordBody } from "../schemas/auth.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// All /user routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// POST /authn/user/sessions:revoke
// Custom action per AIP-136. Routed internally at `/sessions/_actions/revoke`
// (see api.ts for the rewrite rationale). The client-facing endpoint is
// `POST /authn/user/sessions:revoke`.
user.openapi(
  createRoute({
    method: "post",
    path: "/sessions/_actions/revoke",
    tags: ["User"],
    summary: "Revoke the caller's refresh token",
    description:
      "Revokes the caller's refresh token identified by the `X-Refresh-JTI` header. Requires a valid bearer access token. Returns 204 when the token record has been marked revoked.",
    security: [{ Bearer: [] }],
    responses: {
      204: { description: "Refresh token revoked" },
      400: { description: "Missing X-Refresh-JTI header" },
      401: { description: "Missing or invalid bearer token" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const tokenId = c.req.header("x-refresh-jti");
    if (!tokenId) {
      throw new MissingRefreshTokenIdError();
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
    description:
      "Changes the authenticated caller's password after verifying `currentPassword`. The request body supplies both the current password and the replacement password.",
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
