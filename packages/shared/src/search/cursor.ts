/**
 * Opaque keyset cursor codec.
 *
 * Typesense has no native `search_after`. Deep pagination (past the
 * ~10,000 result window) is simulated by:
 *   1. Requiring a stable sort that ends with a unique tiebreaker (`id`).
 *   2. Remembering the last result's sort-values + id.
 *   3. Building a `filter_by` expression on the next request that skips
 *      everything up to and including that point.
 *
 * This codec keeps the cursor opaque to the client: base64(JSON) so the
 * frontend never needs to know the internals. Rotate the format key if
 * we ever change the payload shape — old cursors will decode as invalid
 * and fall back to page 1 instead of silently breaking.
 */

export interface SearchCursor {
  /**
   * Values from the document matching the `sort_by` fields in order,
   * **excluding** the trailing `id` tiebreaker (that lives in `lastId`).
   *
   * Example — for `sort_by=createdAt:desc,id:desc`, `sortValues = [1714500000]`.
   */
  sortValues: Array<string | number>;
  /** Last seen document id — the stable tiebreaker. */
  lastId: string;
  /** Codec version. Bump when the shape changes. */
  v: 1;
}

const CURRENT_VERSION = 1 as const;

export function encodeCursor(cursor: Omit<SearchCursor, "v">): string {
  const payload: SearchCursor = { ...cursor, v: CURRENT_VERSION };
  const json = JSON.stringify(payload);
  // URL-safe base64 so the cursor can ride as a query param without escaping.
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor. Returns `undefined` for any malformed input —
 * the caller should treat that as "no cursor, serve page 1."
 */
export function decodeCursor(raw: string | undefined | null): SearchCursor | undefined {
  if (!raw) return undefined;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<SearchCursor>;
    if (
      parsed.v !== CURRENT_VERSION ||
      typeof parsed.lastId !== "string" ||
      !Array.isArray(parsed.sortValues)
    ) {
      return undefined;
    }
    return {
      sortValues: parsed.sortValues,
      lastId: parsed.lastId,
      v: CURRENT_VERSION,
    };
  } catch {
    return undefined;
  }
}
