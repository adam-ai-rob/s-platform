import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { searchUsers } from "@s-user/core/search/users.search";
import { authMiddleware } from "@s/shared/auth";
import type { AppEnv } from "../types";

const search = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
search.use("*", authMiddleware() as any);

// Deprecation headers middleware - adds Sunset and Deprecation headers to response
search.use("*", async (c, next) => {
  await next();
  // Set deprecation headers for one release cycle
  // Sunset date: 6 weeks from now (typical deprecation window)
  const sunsetDate = new Date();
  sunsetDate.setDate(sunsetDate.getDate() + 42); // 6 weeks
  c.header("Deprecation", "true");
  c.header("Sunset", sunsetDate.toUTCString());
});

const UserHit = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
    highlights: z.record(z.unknown()).optional(),
  })
  .openapi("UserSearchHit");

const UserSearchResponse = z
  .object({
    hits: z.array(UserHit),
    page: z.number().int(),
    per_page: z.number().int(),
    found: z.number().int(),
    out_of: z.number().int(),
    search_time_ms: z.number().int(),
    next_cursor: z.string().optional(),
  })
  .openapi("UserSearchResponse");

const UserSearchQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

search.openapi(
  createRoute({
    method: "get",
    path: "/search",
    tags: ["User"],
    security: [{ Bearer: [] }],
    summary: "Search user profiles (DEPRECATED)",
    description:
      "Linear-style list over the users collection: full-text search + whitelisted filter/sort, page-based pagination with an opt-in opaque keyset cursor for deep scroll.\n\n" +
      "## Deprecation Notice\n" +
      "This endpoint is deprecated and will be removed in the next release.\n" +
      "Use `GET /user/admin/users` instead, which returns a v1 envelope with camelCase fields.",
    request: { query: UserSearchQuery },
    responses: {
      200: {
        content: { "application/json": { schema: UserSearchResponse } },
        description: "Search results (DEPRECATED)",
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
        hits: result.hits,
        page: result.page,
        per_page: result.perPage,
        found: result.found,
        out_of: result.outOf,
        search_time_ms: result.searchTimeMs,
        ...(result.nextCursor ? { next_cursor: result.nextCursor } : {}),
      },
      200,
    );
  },
);

export default search;
