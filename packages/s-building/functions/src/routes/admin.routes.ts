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
      "Typesense-backed list. Superadmin sees every building and may use the full whitelisted Typesense filter DSL. Scoped admin/manager callers see only buildings in their assignment's `value[]`; their `filter_by` may only further narrow results with whitelisted simple clauses joined by `&&`. A scoped caller with an empty scope gets a 200 with an empty data array (no 403).",
    request: { query: ListQuery },
    responses: {
      200: {
        content: { "application/json": { schema: BuildingListResponse } },
        description: "List results",
      },
      400: { description: "Validation error" },
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
      validateScopedAdminFilter(filterBy);
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

const SCOPED_ADMIN_FILTER_FIELDS = new Set([
  "status",
  "countryCode",
  "locality",
  "region",
  "createdAtMs",
  "updatedAtMs",
  "id",
]);

/**
 * Scoped admin filters are security-sensitive because they are AND-ed
 * with the server-owned `id:=[...]` scope gate. Keep callers on a small
 * conjunction-only subset; superadmin keeps the full Typesense DSL.
 */
function validateScopedAdminFilter(filterBy: string | undefined): void {
  if (!filterBy) return;

  if (/[()|$]/.test(filterBy) || filterBy.includes("||")) {
    throw new ValidationError(
      "filter_by for scoped admin callers only supports simple clauses joined by `&&`",
    );
  }

  const clauses = filterBy.split("&&").map((clause) => clause.trim());

  if (clauses.length === 0 || clauses.some((clause) => clause.length === 0)) {
    throw new ValidationError("filter_by must contain at least one clause");
  }

  for (const clause of clauses) {
    validateScopedAdminFilterClause(clause);
  }
}

function validateScopedAdminFilterClause(clause: string): void {
  const match = clause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(=|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) {
    throw new ValidationError(`Invalid scoped filter clause: ${clause}`);
  }

  const field = match[1];
  const value = match[3].trim();

  if (!SCOPED_ADMIN_FILTER_FIELDS.has(field)) {
    throw new ValidationError(`filter_by field not allowed for scoped admin callers: ${field}`);
  }
  if (!isSafeScopedFilterValue(value)) {
    throw new ValidationError(`Invalid scoped filter value for field: ${field}`);
  }
}

function isSafeScopedFilterValue(value: string): boolean {
  if (value.length === 0) return false;
  if (/[:&|()$]/.test(value)) return false;

  if (value.startsWith("[") || value.endsWith("]")) {
    const list = value.match(/^\[(.*)\]$/);
    if (!list) return false;
    const items = list[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 && items.every(isSafeScopedFilterScalar);
  }

  return isSafeScopedFilterScalar(value);
}

function isSafeScopedFilterScalar(value: string): boolean {
  if (/^`[^`]*`$/.test(value)) return true;
  return /^[A-Za-z0-9_.@/-]+$/.test(value);
}
