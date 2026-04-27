import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { BuildingNotFoundError } from "@s-building/core/buildings/buildings.errors";
import { getBuilding } from "@s-building/core/buildings/buildings.service";
import { buildScopedIdFilter, searchBuildings } from "@s-building/core/search/buildings.search";
import { authMiddleware } from "@s/shared/auth";
import { ValidationError } from "@s/shared/errors";
import {
  BuildingIdParam,
  BuildingListResponse,
  BuildingResponse,
  ListQuery,
} from "../schemas/buildings.schema";
import type { AppEnv } from "../types";
import { buildingAccess, callerScopedBuildingIds, hasSuperadmin } from "./_access";

/**
 * User-audience HTTP surface. Mounted under `/building/user`.
 *
 * Read-only over ACTIVE buildings the caller has `building_user`
 * permission on (or everything, if the caller is `building_superadmin`).
 *
 * The module's rule is **404 instead of 403** on hidden or out-of-scope
 * resources — the consumer audience must not leak existence. A caller
 * who hits `/buildings/{id}` for a building they can't see always gets
 * a 404 regardless of whether the row exists, is draft, is archived,
 * or is simply outside their scope. This matches the user-facing rule
 * in `packages/s-building/CLAUDE.md`.
 */

const user = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

// ─── GET /buildings ─── active buildings in caller's user scope ────────────
user.openapi(
  createRoute({
    method: "get",
    path: "/buildings",
    tags: ["Building User"],
    security: [{ Bearer: [] }],
    summary: "List active buildings the caller can see",
    description:
      "Superadmin sees every active building. Any other caller sees only active buildings in their `building_user` scope. Empty scope returns `{ data: [], meta: { found: 0, ... } }` — never a 403.",
    request: { query: ListQuery },
    responses: {
      200: {
        content: { "application/json": { schema: BuildingListResponse } },
        description: "List results",
      },
      401: { description: "Missing or invalid bearer token" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const qp = c.req.valid("query");
    const isSuper = hasSuperadmin(caller) || caller.system === true;

    // User audience never sees drafts or archived rows — `status:=active`
    // is always AND-ed on top of the scope filter.
    const ACTIVE_FILTER = "status:=active";

    // Scope-escape hardening applies to EVERY caller on this audience —
    // even superadmin. A crafted `filter_by` like
    // `status:=active) || (status:=draft` can otherwise slip drafts
    // past the outermost AND on the superadmin path. The user audience
    // is "active rows only, no exceptions" regardless of role.
    if (qp.filter_by && /[()|]/.test(qp.filter_by)) {
      throw new ValidationError("filter_by cannot contain `(`, `)` or `|` on the user audience");
    }

    if (!isSuper) {
      // `callerScopedBuildingIds` drops permissions without a `value`
      // field (the "global variant"). The seeded `building_user` role
      // template always carries `value: []`, so a real assignment will
      // populate specific ids here. If a future role ever grants
      // `building_user` globally, callers on that role will hit the
      // empty-scope short-circuit below (200 empty list) even though
      // `buildingAccess` on a single id would grant. Single-resource
      // GET is source-of-truth; list is a denormalised mirror.
      const scope = callerScopedBuildingIds(caller, ["building_user"]);
      if (scope.length === 0) {
        return c.json(
          {
            data: [],
            meta: {
              page: 1,
              perPage: qp.per_page ?? 20,
              found: 0,
              outOf: 0,
              searchTimeMs: 0,
            },
          },
          200,
        );
      }
      const scopeFilter = buildScopedIdFilter(scope);
      const combined = `(${ACTIVE_FILTER}) && (${scopeFilter})`;
      const filterBy = qp.filter_by ? `(${combined}) && (${qp.filter_by})` : combined;
      const result = await searchBuildings({
        q: qp.q,
        filterBy,
        sortBy: qp.sort_by,
        facetBy: qp.facet_by,
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
            ...(result.facets ? { facets: result.facets } : {}),
          },
        },
        200,
      );
    }

    // Superadmin path — still filter to active only (user audience).
    const filterBy = qp.filter_by ? `(${ACTIVE_FILTER}) && (${qp.filter_by})` : ACTIVE_FILTER;
    const result = await searchBuildings({
      q: qp.q,
      filterBy,
      sortBy: qp.sort_by,
      facetBy: qp.facet_by,
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
          ...(result.facets ? { facets: result.facets } : {}),
        },
      },
      200,
    );
  },
);

// ─── GET /buildings/{id} ─── 404-not-403 for anything hidden ───────────────
user.openapi(
  createRoute({
    method: "get",
    path: "/buildings/{id}",
    tags: ["Building User"],
    security: [{ Bearer: [] }],
    summary: "Get an active building the caller can see",
    description:
      "Returns 200 iff the building is `active` AND the caller has it in `building_user` scope (or is superadmin). Every other case — missing row, draft/archived status, out-of-scope, or non-existent id — returns **404**. This is deliberate: the consumer audience must not leak building existence through a 403.",
    request: { params: BuildingIdParam },
    responses: {
      200: { content: { "application/json": { schema: BuildingResponse } }, description: "Ok" },
      401: { description: "Missing or invalid bearer token" },
      404: { description: "Not found, or not visible to the caller" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");

    // Three gates, each of which collapses to 404 on miss:
    //   1. Scope: superadmin sees everything; others need `building_user` on {id}.
    //   2. Existence: row must exist.
    //   3. Status: row must be `active`.
    if (!buildingAccess(c, id, ["building_user"])) {
      throw new BuildingNotFoundError(id);
    }
    try {
      const building = await getBuilding(id);
      if (building.status !== "active") {
        throw new BuildingNotFoundError(id);
      }
      return c.json({ data: building }, 200);
    } catch (err) {
      // Repository NotFound already maps to 404 via the shared error
      // handler — no-op. Anything else bubbles.
      if (err instanceof BuildingNotFoundError) throw err;
      throw err;
    }
  },
);

export default user;
