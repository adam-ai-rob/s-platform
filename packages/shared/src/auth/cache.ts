import { createHash } from "node:crypto";
import type { UserContext } from "../types/index";

/**
 * In-memory token cache.
 *
 * Lives per Lambda container. Warm starts reuse entries; cold starts
 * rebuild. Keyed by SHA-256 hash of the token (not the token itself)
 * to avoid keeping sensitive strings in memory longer than needed.
 *
 * TTL is short (5 min prod / 1 min dev) so permission changes propagate
 * quickly without requiring a new JWT.
 */

const DEFAULT_TTL_MS = process.env.STAGE === "prod" ? 5 * 60 * 1000 : 1 * 60 * 1000;
const TTL_MS = Number(process.env.AUTHZ_CACHE_TTL_MS ?? DEFAULT_TTL_MS);

interface CacheEntry {
  context: UserContext;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getCached(tokenHash: string): UserContext | null {
  const entry = cache.get(tokenHash);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(tokenHash);
    return null;
  }
  return entry.context;
}

export function setCached(tokenHash: string, context: UserContext): void {
  cache.set(tokenHash, {
    context,
    expires: Date.now() + TTL_MS,
  });

  // Simple size cap — evict oldest if cache grows large
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}
