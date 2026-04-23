import { ValidationError } from "@s/shared/errors";
import {
  type SearchCursor,
  decodeCursor,
  encodeCursor,
  resolveCollectionName,
  searchClient,
} from "@s/shared/search";
import type { SearchResponse } from "typesense/lib/Typesense/Documents";
import { BUILDINGS_ENTITY, type BuildingSearchDocument } from "./buildings.collection";

/**
 * Read-side search for the buildings collection.
 *
 * Mirrors `packages/s-user/core/src/search/users.search.ts` line-for-line
 * where the behaviour is identical; the differences are:
 *   - `id` is in the FILTER_FIELDS allow-list so the route layer can
 *     prepend a scoped `id:=[...]` filter for non-superadmin callers.
 *   - SORT / FILTER whitelists match the #68 issue's column list.
 *   - `query_by` targets the name field.
 */

const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 20;

const SORT_FIELDS = ["createdAtMs", "updatedAtMs", "name", "areaSqm", "population"] as const;
const FILTER_FIELDS = [
  "status",
  "countryCode",
  "locality",
  "region",
  "createdAtMs",
  "updatedAtMs",
  "id",
] as const;
// Facet-able fields must match the `facet: true` entries in the
// collection schema — Typesense 500s at runtime if you ask to facet on
// a non-faceted field, so this allow-list is a tighter subset of
// FILTER_FIELDS (no `id`, no timestamps).
const FACET_FIELDS = ["status", "countryCode", "locality", "region"] as const;

type SortField = (typeof SORT_FIELDS)[number];
type FilterField = (typeof FILTER_FIELDS)[number];
type FacetField = (typeof FACET_FIELDS)[number];

export interface BuildingSearchQuery {
  q?: string;
  filterBy?: string;
  sortBy?: string;
  facetBy?: string;
  page?: number;
  perPage?: number;
  cursor?: string;
}

export interface BuildingSearchHit extends BuildingSearchDocument {
  highlights?: Record<string, unknown>;
}

export interface BuildingSearchResult {
  hits: BuildingSearchHit[];
  page: number;
  perPage: number;
  found: number;
  outOf: number;
  searchTimeMs: number;
  nextCursor?: string;
  facets?: Array<{
    field: string;
    counts: Array<{ value: string; count: number }>;
  }>;
}

export async function searchBuildings(query: BuildingSearchQuery): Promise<BuildingSearchResult> {
  const perPage = clampPerPage(query.perPage);
  const page = Math.max(1, query.page ?? 1);
  const q = query.q && query.q.trim().length > 0 ? query.q : "*";
  const sortBy = query.sortBy ? validateSortExpression(query.sortBy) : "createdAtMs:desc";
  const filterBy = query.filterBy ? validateFilterExpression(query.filterBy) : undefined;
  const facetBy = query.facetBy ? validateFacetExpression(query.facetBy) : undefined;

  const decodedCursor = decodeCursor(query.cursor);
  const cursorFilter = decodedCursor ? buildCursorFilter(sortBy, decodedCursor) : undefined;
  const combinedFilter = joinFilters(filterBy, cursorFilter);

  const client = await searchClient();
  const collection = resolveCollectionName(BUILDINGS_ENTITY);

  let response: SearchResponse<BuildingSearchDocument>;
  try {
    response = await client
      .collections<BuildingSearchDocument>(collection)
      .documents()
      .search({
        q,
        query_by: "name",
        sort_by: sortBy,
        ...(combinedFilter ? { filter_by: combinedFilter } : {}),
        ...(facetBy ? { facet_by: facetBy } : {}),
        page: decodedCursor ? 1 : page,
        per_page: perPage,
      });
  } catch (err) {
    // Freshly-bootstrapped stage — indexer hasn't created the collection
    // yet. Same pattern as s-user: surface empty instead of 500.
    if (isCollectionNotFound(err)) {
      return {
        hits: [],
        page: decodedCursor ? 1 : page,
        perPage,
        found: 0,
        outOf: 0,
        searchTimeMs: 0,
      };
    }
    throw err;
  }

  const hits: BuildingSearchHit[] = (response.hits ?? []).map((hit) => ({
    ...(hit.document as BuildingSearchDocument),
    highlights: hit.highlights as Record<string, unknown> | undefined,
  }));

  const nextCursor =
    hits.length === perPage ? buildNextCursor(sortBy, hits[hits.length - 1]) : undefined;

  const facets = response.facet_counts?.map((f) => ({
    field: f.field_name,
    counts: (f.counts ?? []).map((c) => ({ value: c.value, count: c.count })),
  }));

  return {
    hits,
    page: decodedCursor ? 1 : page,
    perPage,
    found: response.found ?? 0,
    outOf: response.out_of ?? 0,
    searchTimeMs: response.search_time_ms ?? 0,
    nextCursor,
    ...(facets && facets.length > 0 ? { facets } : {}),
  };
}

export function isCollectionNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { httpStatus?: number; message?: string };
  if (anyErr.httpStatus !== 404) return false;
  const msg = typeof anyErr.message === "string" ? anyErr.message.toLowerCase() : "";
  return msg.includes("not found") && msg.includes("collection");
}

function clampPerPage(input: number | undefined): number {
  if (input === undefined) return DEFAULT_PER_PAGE;
  if (input <= 0) return DEFAULT_PER_PAGE;
  return Math.min(input, MAX_PER_PAGE);
}

function validateSortExpression(raw: string): string {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new ValidationError("sort_by must contain at least one field");
  }
  for (const part of parts) {
    const [field, direction] = part.split(":");
    if (!field || !direction) {
      throw new ValidationError(`Invalid sort clause: ${part}`);
    }
    if (!SORT_FIELDS.includes(field as SortField)) {
      throw new ValidationError(`sort_by field not allowed: ${field}`);
    }
    if (direction !== "asc" && direction !== "desc") {
      throw new ValidationError(`sort direction must be asc or desc: ${part}`);
    }
  }
  return parts.join(",");
}

function validateFilterExpression(raw: string): string {
  const referenced = new Set<string>();
  for (const match of raw.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
    referenced.add(match[1]);
  }
  for (const field of referenced) {
    if (!FILTER_FIELDS.includes(field as FilterField)) {
      throw new ValidationError(`filter_by field not allowed: ${field}`);
    }
  }
  return raw;
}

function validateFacetExpression(raw: string): string {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (!FACET_FIELDS.includes(part as FacetField)) {
      throw new ValidationError(`facet_by field not allowed: ${part}`);
    }
  }
  return parts.join(",");
}

function joinFilters(a: string | undefined, b: string | undefined): string | undefined {
  if (a && b) return `(${a}) && (${b})`;
  return a ?? b;
}

/**
 * Build a Typesense `id:=[...]` filter from a set of building ids. The
 * route layer calls this to gate non-superadmin list queries to the
 * caller's permission scope.
 *
 * Empty scope is its own 200-with-empty-list case in the route — this
 * function refuses it so a missing scope can never silently become
 * "unfiltered" against the index.
 */
export function buildScopedIdFilter(buildingIds: readonly string[]): string {
  if (buildingIds.length === 0) {
    throw new Error("buildScopedIdFilter called with empty scope");
  }
  const escaped = buildingIds.map((id) => `\`${id.replace(/`/g, "")}\``).join(",");
  return `id:=[${escaped}]`;
}

interface ParsedSortClause {
  field: SortField;
  direction: "asc" | "desc";
}

function parseSort(sortBy: string): ParsedSortClause[] {
  return sortBy
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, direction] = part.split(":");
      return {
        field: field as SortField,
        direction: direction as "asc" | "desc",
      };
    });
}

function buildCursorFilter(sortBy: string, cursor: SearchCursor): string {
  const clauses = parseSort(sortBy);
  const pieces: string[] = [];

  for (let i = 0; i < clauses.length; i++) {
    const equals: string[] = [];
    for (let j = 0; j < i; j++) {
      const prior = clauses[j];
      equals.push(`${prior.field}:=${cursor.sortValues[j]}`);
    }
    const current = clauses[i];
    const op = current.direction === "desc" ? "<" : ">";
    const currentClause = `${current.field}:${op}${cursor.sortValues[i]}`;
    pieces.push([...equals, currentClause].join(" && "));
  }

  const allEqual = clauses.map((c, i) => `${c.field}:=${cursor.sortValues[i]}`);
  const idBranch = [...allEqual, `id:!=\`${cursor.lastId.replace(/`/g, "")}\``].join(" && ");
  pieces.push(idBranch);

  return pieces.map((p) => `(${p})`).join(" || ");
}

function buildNextCursor(sortBy: string, lastHit: BuildingSearchDocument): string {
  const clauses = parseSort(sortBy);
  const sortValues: Array<string | number> = [];
  for (const clause of clauses) {
    const value = (lastHit as unknown as Record<string, string | number>)[clause.field];
    sortValues.push(value);
  }
  return encodeCursor({ sortValues, lastId: lastHit.id });
}
