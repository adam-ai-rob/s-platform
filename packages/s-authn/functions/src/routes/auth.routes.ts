import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { logout } from "@s-authn/core/auth/auth.service";
import { authMiddleware } from "@s/shared/auth";
import type { AppEnv } from "../types";

const auth = new OpenAPIHono<AppEnv>();

// All routes require auth
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
auth.use("*", authMiddleware() as any);

// POST /sessions:revoke - Revoke a refresh token (AIP-136 custom action)
// The public URL is POST /authn/user/sessions:revoke
// Internally routed to /_actions/revoke via route rewrite (see api.ts)
auth.openapi(
  createRoute({
    method: "post",
    path: "/sessions/_actions/revoke",
    tags: ["Session"],
    summary: "Revoke refresh tokens (AIP-136 custom action)",
    description:
      "Revoke refresh tokens for the caller. The public URL is `POST /authn/user/sessions:revoke`.\n" +
      "This uses the AIP-136 workaround where colon-prefixed actions are rewritten to `/_actions/{verb}`.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              tokenIds: z.array(z.string()).optional(),
              all: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      204: { description: "Tokens revoked" },
      400: { description: "Invalid request" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const body = c.req.valid("json");

    // If 'all' is true, we need to revoke all tokens for this user
    // For now, we'll accept thetokenId from header as before but also support tokenIds in body
    let tokenId = c.req.header("x-refresh-jti");

    if (body.all) {
      // TODO: Implement bulk revoke
      return c.json(
        {
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Bulk token revocation not yet implemented",
          },
        },
        501,
      );
    }

    if (!tokenId && body.tokenIds && body.tokenIds.length > 0) {
      tokenId = body.tokenIds[0];
    }

    if (!tokenId) {
      return c.json(
        {
          error: {
            code: "MISSING_REFRESH_JTI",
            message: "X-Refresh-JTI header or tokenIds body required for logout",
          },
        },
        400,
      );
    }

    await logout({ userId: caller.userId, tokenId });
    return c.body(null, 204);
  },
);

// Legacy routes with deprecation headers - for backward compatibility during v1 retrofit

const deprecatedAuth = new OpenAPIHono<AppEnv>();

// Deprecation headers middleware
deprecatedAuth.use("*", async (c, next) => {
  await next();
  const sunsetDate = new Date();
  sunsetDate.setDate(sunsetDate.getDate() + 42);
  c.header("Deprecation", "true");
  c.header("Sunset", sunsetDate.toUTCString());
});

// POST /me/logout - LEGACY: Revoke caller's refresh token
deprecatedAuth.openapi(
  createRoute({
    method: "post",
    path: "/me/logout",
    tags: ["User (DEPRECATED)"],
    summary: "Revoke the caller's refresh token (DEPRECATED)",
    description:
      "Legacy endpoint. Deprecated and will be removed in the next release.\n" +
      "Use `POST /authn/user/sessions:revoke` instead.",
    security: [{ Bearer: [] }],
    responses: {
      204: { description: "Logged out" },
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

export default auth;
export { deprecatedAuth };
