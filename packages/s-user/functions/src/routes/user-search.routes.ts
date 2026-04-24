import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { searchUsers } from "@s-user/core/search/users.search";
import { authMiddleware } from "@s/shared/auth";
import { ForbiddenError } from "@s/shared/errors";
import type { Context } from "hono";
import {
  LegacyUserSearchResponse,
  UserSearchListResponse,
  UserSearchQuery,
} from "../schemas/profile.schema";
import type { AppEnv } from "../types";

const search = new OpenAPIHono<AppEnv>();
const LEGACY_SUNSET = "Fri, 01 May 2026 00:00:00 GMT";

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
search.use("*", authMiddleware() as any);

function markLegacy(c: Context<AppEnv>): void {
  c.header("Deprecation", "true");
  c.header("Sunset", LEGACY_SUNSET);
}

function requireUserSuperadmin(c: Context<AppEnv>): void {
  const caller = c.get("user");
  const allowed =
    caller.system === true || caller.permissions.some((p) => p.id === "user_superadmin");
  if (!allowed) throw new ForbiddenError("Missing permission: user_superadmin");
}

search.openapi(
  createRoute({
    method: "get",
    path: "/admin/users",
    tags: ["User Admin"],
    security: [{ Bearer: [] }],
    summary: "Search user profiles",
    description: "Typesense-backed list over user profiles. Requires `user_superadmin`.",
    request: { query: UserSearchQuery },
    responses: {
      200: {
        content: { "application/json": { schema: UserSearchListResponse } },
        description: "Search results",
      },
      403: { description: "Missing permission" },
    },
  }),
  async (c) => {
    requireUserSuperadmin(c);
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
        metadata: {
          ...(result.nextCursor ? { nextToken: result.nextCursor } : {}),
        },
      },
      200,
    );
  },
);

search.openapi(
  createRoute({
    method: "get",
    path: "/search",
    tags: ["User Legacy"],
    security: [{ Bearer: [] }],
    summary: "Search user profiles (deprecated)",
    description:
      "Deprecated legacy list shape. Use `GET /user/admin/users` and read `{ data, meta }`.",
    request: { query: UserSearchQuery },
    responses: {
      200: {
        content: { "application/json": { schema: LegacyUserSearchResponse } },
        description: "Search results",
      },
    },
  }),
  async (c) => {
    markLegacy(c);
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
        data: result.hits,
        meta: {
          page: result.page,
          perPage: result.perPage,
          found: result.found,
          outOf: result.outOf,
          searchTimeMs: result.searchTimeMs,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
        metadata: {
          ...(result.nextCursor ? { nextToken: result.nextCursor } : {}),
        },
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
