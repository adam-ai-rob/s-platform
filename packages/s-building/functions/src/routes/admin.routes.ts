import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  activateBuilding,
  archiveBuilding,
  createBuilding,
  deleteBuilding,
  getBuilding,
  updateBuilding,
} from "@s-building/core/buildings/buildings.service";
import { buildScopedIdFilter, searchBuildings } from "@s-building/core/search/buildings.search";
import { authMiddleware } from "@s/shared/auth";
import { ForbiddenError, ValidationError } from "@s/shared/errors";
import {
  BuildingIdParam,
  BuildingListResponse,
  BuildingResponse,
  CreateBuildingBody,
  ListQuery,
  UpdateBuildingBody,
} from "../schemas/buildings.schema";
import type { AppEnv } from "../types";
import { buildingAccess, callerScopedBuildingIds, hasSuperadmin } from "./_access";

/**
 * Admin-audience HTTP surface. Mounted under `/building/admin`.
 *
 * Scoped-permission enforcement lives in this file (the controller
 * layer), not in the service — see the module `CLAUDE.md` for the
 * rationale. Each route extracts the target building id, calls
 * `buildingAccess(...)` with the permission set that matches its gate,
 * and throws `ForbiddenError` on miss. The service methods are called
 * with already-validated inputs and know nothing about the caller.
 */

const admin = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", authMiddleware() as any);

// ─── POST /buildings ─── superadmin only ───────────────────────────────────
admin.openapi(
  createRoute({
    method: "post",
    path: "/buildings",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Create a building",
    description: "Creates a new building. Requires `building_superadmin`.",
    request: {
      body: { content: { "application/json": { schema: CreateBuildingBody } }, required: true },
    },
    responses: {
      201: {
        content: { "application/json": { schema: BuildingResponse } },
        description: "Created",
        headers: {
          Location: {
            schema: { type: "string" },
            description: "Canonical URL of the new resource",
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing permission" },
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!hasSuperadmin(user) && user.system !== true) {
      throw new ForbiddenError("building_superadmin required to create buildings");
    }
    const body = c.req.valid("json");
    const building = await createBuilding(body);
    c.header("Location", `/building/admin/buildings/${building.buildingId}`);
    return c.json({ data: building }, 201);
  },
);

// ─── GET /buildings ─── superadmin OR any scoped admin/manager role ────────
admin.openapi(
  createRoute({
    method: "get",
    path: "/buildings",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "List buildings",
    description:
      "Typesense-backed list. Superadmin sees every building; scoped admin/manager callers see only buildings in their assignment's `value[]`. A scoped caller with an empty scope gets a 200 with an empty data array (no 403).",
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
    const user = c.get("user");
    const qp = c.req.valid("query");

    const scopedPermissions = ["building_admin", "building_manager"] as const;
    const isSuper = hasSuperadmin(user) || user.system === true;

    let filterBy = qp.filter_by;
    if (!isSuper) {
      // Non-superadmin callers cannot use OR/parens/pipes in `filter_by`
      // — those can craft a top-level OR that escapes the scope filter
      // (e.g. `id:=[foo]) || (status:=active` would let a scoped caller
      // read every active building). We keep the DSL restricted to
      // simple `field:op value` chains joined by `&&`. Superadmin keeps
      // the full DSL because there is no scope gate to escape.
      if (filterBy && /[()|]/.test(filterBy)) {
        throw new ValidationError(
          "filter_by cannot contain `(`, `)` or `|` for non-superadmin callers",
        );
      }
      const scope = callerScopedBuildingIds(user, scopedPermissions);
      if (scope.length === 0) {
        // Empty scope → 200 with empty list. Do NOT call Typesense with
        // no filter — that would leak the whole collection.
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
      // Scope filter is the OUTERMOST clause so any operator precedence
      // surprise in the caller's expression still lands inside the
      // AND — the filter is load-bearing for security.
      filterBy = filterBy ? `(${scopeFilter}) && (${filterBy})` : scopeFilter;
    }

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

// ─── GET /buildings/{id} ─── superadmin OR scoped admin/manager ────────────
admin.openapi(
  createRoute({
    method: "get",
    path: "/buildings/{id}",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Get a building",
    description:
      "Returns one building by id for callers with `building_superadmin`, scoped `building_admin`, or scoped `building_manager`. Admin callers outside the building scope receive 403; missing buildings return 404.",
    request: { params: BuildingIdParam },
    responses: {
      200: { content: { "application/json": { schema: BuildingResponse } }, description: "Ok" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Not in caller's scope" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    if (!buildingAccess(c, id, ["building_admin", "building_manager"])) {
      throw new ForbiddenError(`No admin access to building ${id}`);
    }
    const building = await getBuilding(id);
    return c.json({ data: building }, 200);
  },
);

// ─── PATCH /buildings/{id} ─── superadmin OR scoped admin/manager ──────────
admin.openapi(
  createRoute({
    method: "patch",
    path: "/buildings/{id}",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Update a building",
    description:
      "PATCH does not change status — use `:archive` or `:activate` for lifecycle transitions.",
    request: {
      params: BuildingIdParam,
      body: { content: { "application/json": { schema: UpdateBuildingBody } }, required: true },
    },
    responses: {
      200: { content: { "application/json": { schema: BuildingResponse } }, description: "Ok" },
      400: { description: "Validation error" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Not in caller's scope" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    if (!buildingAccess(c, id, ["building_admin", "building_manager"])) {
      throw new ForbiddenError(`No admin access to building ${id}`);
    }
    const body = c.req.valid("json");
    const building = await updateBuilding(id, body);
    return c.json({ data: building }, 200);
  },
);

// ─── POST /buildings/{id}:archive ─── superadmin OR scoped admin ───────────
//
// Hono's trie router can't parse AIP-136 `:verb` paths (the `:` conflicts
// with its `:param` prefix syntax — verified across all three router
// backends). To honour the client-facing convention while keeping the router
// happy, the module's `fetch` wrapper rewrites inbound `…:verb` URLs to
// `…/_actions/verb` before dispatch; OpenAPI docs keep the colon form
// via a `publicPath` post-processor on the contract (see api.ts).
admin.openapi(
  createRoute({
    method: "post",
    path: "/buildings/{id}/_actions/archive",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Archive a building (active → archived)",
    description:
      "Transitions an active building to `archived`. Requires `building_superadmin` or scoped `building_admin`; scoped managers can read and update but cannot archive. Returns 409 when the building is not in a status that can be archived.",
    request: { params: BuildingIdParam },
    responses: {
      200: { content: { "application/json": { schema: BuildingResponse } }, description: "Ok" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Not in caller's scope (manager can read/update but not archive)" },
      404: { description: "Not found" },
      409: { description: "Illegal status transition" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    if (!buildingAccess(c, id, ["building_admin"])) {
      throw new ForbiddenError(`No admin access to building ${id}`);
    }
    const building = await archiveBuilding(id);
    return c.json({ data: building }, 200);
  },
);

// ─── POST /buildings/{id}:activate ─── superadmin OR scoped admin ──────────
admin.openapi(
  createRoute({
    method: "post",
    path: "/buildings/{id}/_actions/activate",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Activate a building (draft/archived → active)",
    description:
      "Transitions a draft or archived building to `active`. Requires `building_superadmin` or scoped `building_admin`. Returns 409 when the building is not in a status that can be activated.",
    request: { params: BuildingIdParam },
    responses: {
      200: { content: { "application/json": { schema: BuildingResponse } }, description: "Ok" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Not in caller's scope" },
      404: { description: "Not found" },
      409: { description: "Illegal status transition" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    if (!buildingAccess(c, id, ["building_admin"])) {
      throw new ForbiddenError(`No admin access to building ${id}`);
    }
    const building = await activateBuilding(id);
    return c.json({ data: building }, 200);
  },
);

// ─── DELETE /buildings/{id} ─── superadmin OR scoped admin ─────────────────
admin.openapi(
  createRoute({
    method: "delete",
    path: "/buildings/{id}",
    tags: ["Building Admin"],
    security: [{ Bearer: [] }],
    summary: "Delete a building",
    description:
      "Hard-deletes a building. Requires `building_superadmin` or scoped `building_admin`; scoped managers and users receive 403.",
    request: { params: BuildingIdParam },
    responses: {
      204: { description: "Deleted" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Not in caller's scope" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    if (!buildingAccess(c, id, ["building_admin"])) {
      throw new ForbiddenError(`No admin access to building ${id}`);
    }
    await deleteBuilding(id);
    return c.body(null, 204);
  },
);

export default admin;
