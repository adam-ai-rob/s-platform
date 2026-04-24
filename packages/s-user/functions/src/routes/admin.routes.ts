import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { getProfile } from "@s-user/core/profiles/profiles.service";
import { searchUsers } from "@s-user/core/search/users.search";
import { authMiddleware, requirePermission } from "@s/shared/auth";
import {
  ProfileResponse,
  UserIdParam,
  UserListQuery,
  UserListResponse,
} from "../schemas/profile.schema";
import type { AppEnv } from "../types";

/**
 * Admin-audience routes for s-user. Mounted under `/user/admin`.
 *
 * Gated by the global `user_superadmin` permission — there is no
 * resource-scoped admin tier for profiles (profiles aren't scoped the
 * way buildings are).
 */
const admin = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", authMiddleware() as any);
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", requirePermission("user_superadmin") as any);

admin.openapi(
  createRoute({
    method: "get",
    path: "/users",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "Search user profiles",
    description:
      "Typesense-backed list over the users collection: full-text search + whitelisted filter/sort, page-based pagination with an opt-in opaque keyset cursor for deep scroll. Requires `user_superadmin`.",
    request: { query: UserListQuery },
    responses: {
      200: {
        content: { "application/json": { schema: UserListResponse } },
        description: "List results",
      },
    },
  }),
  async (c) => {
    const qp = c.req.valid("query");
    const result = await searchUsers({
      q: qp.q,
      filterBy: qp.filter_by,
      sortBy: qp.sort_by,
      page: qp.page,
      perPage: qp.per_page,
      cursor: qp.cursor,
    });
    return c.json(
      {
        data: result.hits,
        meta: {
          page: result.page,
          perPage: result.perPage,
          found: result.found,
          outOf: result.outOf,
          searchTimeMs: result.searchTimeMs,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
      200,
    );
  },
);

admin.openapi(
  createRoute({
    method: "get",
    path: "/users/{id}",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "Get any user's profile",
    request: { params: UserIdParam },
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

export default admin;
