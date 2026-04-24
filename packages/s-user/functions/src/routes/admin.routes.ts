import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getProfile } from "@s-user/core/profiles/profiles.service";
import { type UserSearchResult, searchUsers } from "@s-user/core/search/users.search";
import { authMiddleware } from "@s/shared/auth";
import { requireSuperadmin } from "../_access";
import { ProfileResponse } from "../schemas/profile.schema";
import type { AppEnv } from "../types";

/**
 * Admin-audience HTTP surface. Mounted under `/user/admin`.
 *
 * Admin routes provide full access to user data but require the
 * `user_superadmin` permission. This is a global permission that grants
 * access to all user profiles regardless of the caller's personal scope.
 */

const admin = new OpenAPIHono<AppEnv>();

// Define the response schema first (before use in createRoute)
const UserListResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  meta: z.object({
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    found: z.number().int(),
    outOf: z.number().int(),
    searchTimeMs: z.number().int(),
    nextCursor: z.string().optional(),
  }),
});

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", authMiddleware() as any);

// Helper to build the v1 list envelope from search result
function buildUserListEnvelope(result: UserSearchResult) {
  return {
    data: result.hits.map((hit) => ({
      id: hit.id,
      firstName: hit.firstName,
      lastName: hit.lastName,
      displayName: hit.displayName,
      avatarUrl: hit.avatarUrl,
      createdAt: new Date(hit.createdAtMs).toISOString(),
      updatedAt: new Date(hit.updatedAtMs).toISOString(),
    })),
    meta: {
      page: result.page,
      perPage: result.perPage,
      found: result.found,
      outOf: result.outOf,
      searchTimeMs: result.searchTimeMs,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    },
  };
}

// GET /users - List/search all users (admin)
admin.openapi(
  createRoute({
    method: "get",
    path: "/users",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "List/search all user profiles (admin)",
    description:
      "Typesense-backed search over all users. Requires `user_superadmin` permission. Returns v1 envelope with camelCase fields.",
    request: {
      query: z.object({
        q: z.string().optional(),
        filter_by: z.string().optional(),
        sort_by: z.string().optional(),
        page: z.coerce.number().int().positive().optional(),
        per_page: z.coerce.number().int().positive().optional(),
        cursor: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: UserListResponse } },
        description: "List results",
      },
      403: { description: "Missing user_superadmin permission" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    requireSuperadmin(caller);

    const qp = c.req.valid("query");
    const result = await searchUsers({
      q: qp.q,
      filterBy: qp.filter_by,
      sortBy: qp.sort_by,
      page: qp.page,
      perPage: qp.per_page,
      cursor: qp.cursor,
    });

    return c.json(buildUserListEnvelope(result), 200);
  },
);

// GET /users/{id} - Get any user's profile (admin)
admin.openapi(
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

export default admin;
