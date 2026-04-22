import { ValidationError } from "@s/shared/errors";
import {
  type SearchCursor,
  decodeCursor,
  encodeCursor,
  resolveCollectionName,
  searchClient,
} from "@s/shared/search";
import type { SearchResponse } from "typesense/lib/Typesense/Documents";
import { USERS_ENTITY, type UserSearchDocument } from "./users.collection";

/**
 * Read-side search for the users collection.
 *
 * Owns:
 *   - Input validation (whitelists for filter/sort/facet fields)
 *   - Translation of our public query model into Typesense parameters
 *   - Cursor-based keyset pagination for deep scroll
 *   - Mapping the Typesense response into our public envelope
 *
 * Scopes:
 *   - `per_page` is clamped to ≤ MAX_PER_PAGE server-side even though
 *     Typesense allows 250 — protects the shared cluster from abuse.
 *   - Filter/sort fields are whitelisted; any attempt to reference a
 *     field that isn't on the allow-list is a 400 ValidationError.
 */

const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 20;

const SORT_FIELDS = ["createdAtMs", "updatedAtMs", "displayName"] as const;
const FILTER_FIELDS = ["createdAtMs", "updatedAtMs"] as const;

type SortField = (typeof SORT_FIELDS)[number];
type FilterField = (typeof FILTER_FIELDS)[number];

export interface UserSearchQuery {
  q?: string;
  /**
   * Raw Typesense filter expression, whitelisted. Parsed to make sure no
   * field outside `FILTER_FIELDS` is referenced. Kept as-is on the wire
   * since it's the native Typesense grammar clients already know.
   */
  filterBy?: string;
  /**
   * Raw Typesense sort expression, whitelisted. Defaults to
   * `createdAtMs:desc`. Typesense does NOT allow declaring `id` as a
   * sortable field, so the tiebreaker is handled via `filter_by` on
   * the cursor path, not via `sort_by`.
   */
  sortBy?: string;
  page?: number;
  perPage?: number;
  cursor?: string;
}

export interface UserSearchHit extends UserSearchDocument {
  highlights?: Record<string, unknown>;
}

export interface UserSearchResult {
  hits: UserSearchHit[];
  page: number;
  perPage: number;
  found: number;
  outOf: number;
  searchTimeMs: number;
  nextCursor?: string;
}

export async function searchUsers(query: UserSearchQuery): Promise<UserSearchResult> {
  const perPage = clampPerPage(query.perPage);
  const page = Math.max(1, query.page ?? 1);
  const q = query.q && query.q.trim().length > 0 ? query.q : "*";
  const sortBy = query.sortBy ? validateSortExpression(query.sortBy) : "createdAtMs:desc";
  const filterBy = query.filterBy ? validateFilterExpression(query.filterBy) : undefined;

  const decodedCursor = decodeCursor(query.cursor);
  const cursorFilter = decodedCursor ? buildCursorFilter(sortBy, decodedCursor) : undefined;
  const combinedFilter = joinFilters(filterBy, cursorFilter);

  const client = await searchClient();
  const collection = resolveCollectionName(USERS_ENTITY);

  let response: SearchResponse<UserSearchDocument>;
  try {
    response = await client
      .collections<UserSearchDocument>(collection)
      .documents()
      .search({
        q,
        query_by: "displayName,firstName,lastName",
        sort_by: sortBy,
        ...(combinedFilter ? { filter_by: combinedFilter } : {}),
        // When a cursor is present we always serve "page 1" relative to
        // the filtered slice — the cursor itself carries the offset state.
        page: decodedCursor ? 1 : page,
        per_page: perPage,
      });
  } catch (err) {
    // A freshly-bootstrapped stage has no collection yet — the indexer
    // lazily creates it on first event. Treat "collection not found"
    // as "no users match" rather than 500, so the UI can render an
    // empty list while the first events propagate.
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

  const hits: UserSearchHit[] = (response.hits ?? []).map((hit) => ({
    ...(hit.document as UserSearchDocument),
    highlights: hit.highlights as Record<string, unknown> | undefined,
  }));

  const nextCursor =
    hits.length === perPage ? buildNextCursor(sortBy, hits[hits.length - 1]) : undefined;

  return {
    hits,
    page: decodedCursor ? 1 : page,
    perPage,
    found: response.found ?? 0,
    outOf: response.out_of ?? 0,
    searchTimeMs: response.search_time_ms ?? 0,
    nextCursor,
  };
}

/**
 * Narrowly detect "the collection itself does not exist" — the indexer
 * hasn't run yet. Any other 404 (missing field, wrong sort, etc.) is a
 * real bug and should surface as a 500 so it gets caught in dev.
 */
function isCollectionNotFound(err: unknown): boolean {
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
  // Extract every token that looks like `fieldName:` and check it's allow-listed.
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

function joinFilters(a: string | undefined, b: string | undefined): string | undefined {
  if (a && b) return `(${a}) && (${b})`;
  return a ?? b;
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

/**
 * Build the Typesense filter that skips everything up to and including
 * the cursor's last document, treating `id` as a non-sortable tiebreaker
 * via `filter_by` inequality.
 *
 * For a sort like `createdAtMs:desc`, cursor = {sortValues:[1000], lastId:"abc"}:
 *   (createdAtMs:<1000) || (createdAtMs:=1000 && id:!=`abc`)
 *
 * For multi-field sort `f1:desc,f2:desc`, we cascade:
 *   (f1<v1) || (f1=v1 && f2<v2) || (f1=v1 && f2=v2 && id:!=lastId)
 */
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

  // Final branch: all sort values equal → exclude the last-seen id so
  // no document is served twice across page boundaries with duplicate
  // sort values.
  const allEqual = clauses.map((c, i) => `${c.field}:=${cursor.sortValues[i]}`);
  const idBranch = [...allEqual, `id:!=\`${cursor.lastId.replace(/`/g, "")}\``].join(" && ");
  pieces.push(idBranch);

  return pieces.map((p) => `(${p})`).join(" || ");
}

function buildNextCursor(sortBy: string, lastHit: UserSearchDocument): string {
  const clauses = parseSort(sortBy);
  const sortValues: Array<string | number> = [];
  for (const clause of clauses) {
    const value = (lastHit as unknown as Record<string, string | number>)[clause.field];
    sortValues.push(value);
  }
  return encodeCursor({ sortValues, lastId: lastHit.id });
}
