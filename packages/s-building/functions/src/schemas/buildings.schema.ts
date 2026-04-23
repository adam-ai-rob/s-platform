import { z } from "@hono/zod-openapi";
import { Address, BuildingStatus } from "@s-building/core/buildings/buildings.entity";

/**
 * HTTP request / response shapes for `/building/admin/*` and
 * `/building/user/*`. Keep these distinct from the core entity so the
 * API contract evolves independently of the persisted shape.
 *
 * The response schema is the **public API contract** — any change here
 * needs explicit approval and will be flagged by `scripts/contract-diff.ts`.
 * Adding new optional fields is safe; removing or narrowing is not.
 */

const Iso8601 = z.string().openapi({
  format: "date-time",
  example: "2026-04-22T08:00:00.000Z",
});

const Int64 = z.number().int().openapi({ format: "int64" });

export const BuildingResource = z
  .object({
    buildingId: z.string().openapi({ example: "01HXYBUILDING00000000000000" }),
    name: z.string(),
    description: z.string().optional(),
    address: Address,
    areaSqm: z.number(),
    population: z.number().int(),
    primaryLanguage: z.string(),
    supportedLanguages: z.array(z.string()),
    currency: z.string(),
    timezone: z.string(),
    status: BuildingStatus,
    createdAt: Iso8601,
    updatedAt: Iso8601,
    createdAtMs: Int64,
    updatedAtMs: Int64,
  })
  .openapi("Building");

export const BuildingResponse = z
  .object({
    data: BuildingResource,
  })
  .openapi("BuildingResponse");

export const CreateBuildingBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    address: Address,
    areaSqm: z.number().min(0),
    population: z.number().int().min(0),
    primaryLanguage: z.string(),
    supportedLanguages: z.array(z.string()).min(1).max(50),
    currency: z.string().length(3),
    timezone: z.string(),
    status: BuildingStatus.optional(),
  })
  .openapi("CreateBuildingBody");

export const UpdateBuildingBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    address: Address.optional(),
    areaSqm: z.number().min(0).optional(),
    population: z.number().int().min(0).optional(),
    primaryLanguage: z.string().optional(),
    supportedLanguages: z.array(z.string()).min(1).max(50).optional(),
    currency: z.string().length(3).optional(),
    timezone: z.string().optional(),
  })
  .openapi("UpdateBuildingBody");

/**
 * Flat shape of a building document in Typesense — the list / search
 * endpoints return this, NOT the full `BuildingResource`. Consumers who
 * need the full row call `GET /buildings/{id}` for any hit they care
 * about.
 */
const BuildingHit = z
  .object({
    id: z.string(),
    name: z.string(),
    status: BuildingStatus,
    countryCode: z.string(),
    locality: z.string(),
    region: z.string().optional(),
    createdAtMs: Int64,
    updatedAtMs: Int64,
    areaSqm: Int64,
    population: Int64,
    highlights: z.record(z.unknown()).optional(),
  })
  .openapi("BuildingSearchHit");

const ListMeta = z
  .object({
    page: z.number().int(),
    perPage: z.number().int(),
    found: z.number().int(),
    outOf: z.number().int(),
    searchTimeMs: z.number().int(),
    nextCursor: z.string().optional(),
    facets: z
      .array(
        z.object({
          field: z.string(),
          counts: z.array(z.object({ value: z.string(), count: z.number().int() })),
        }),
      )
      .optional(),
  })
  .openapi("BuildingListMeta");

export const BuildingListResponse = z
  .object({
    data: z.array(BuildingHit),
    meta: ListMeta,
  })
  .openapi("BuildingListResponse");

export const ListQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  facet_by: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  // Hard cap at the conventions doc's ≤100 ceiling. Validator rejects
  // with 400; `searchBuildings.clampPerPage` still applies as a
  // belt-and-braces defence for any caller path that bypasses zod.
  per_page: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export const BuildingIdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" } }),
});
