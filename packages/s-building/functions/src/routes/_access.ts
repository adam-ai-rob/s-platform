import type { UserContext } from "@s/shared/types";
import type { Context } from "hono";
import type { AppEnv } from "../types";

/**
 * Scoped-permission gate used by the admin + user building routes.
 *
 * The service layer stays permission-agnostic (per the platform rules
 * and module CLAUDE.md). All scope checking lives here, in the route
 * layer, so the service can be tested without any auth context.
 *
 * Rules:
 *   - A caller with `building_superadmin` (global) is granted access.
 *   - Otherwise the caller must hold at least one permission in
 *     `permissionIds` whose `value: unknown[]` contains `buildingId`.
 *   - A permission on the caller WITHOUT a `value` field is global by
 *     convention (see `packages/s-authz/CLAUDE.md`) and is therefore
 *     accepted without a scope check.
 *
 * Intentional behaviour:
 *   - Empty `value: []` on an assignment means "no buildings in scope"
 *     and is NOT global — the caller gets no access through that
 *     permission.
 *   - String equality is sufficient: `buildingId`s are opaque ULIDs.
 *
 * This helper is a pure read over `c.get("user")` — no I/O, no throwing
 * on deny. Callers decide whether to return 403 or 404; the admin
 * audience throws 403 so clients see the permission gap, the user
 * audience throws 404 to hide existence.
 */

export function hasSuperadmin(user: UserContext): boolean {
  return user.permissions.some((p) => p.id === "building_superadmin");
}

export function callerScopedBuildingIds(
  user: UserContext,
  permissionIds: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const p of user.permissions) {
    if (!permissionIds.includes(p.id)) continue;
    if (!p.value) continue; // global variant — see function docstring
    for (const v of p.value) {
      if (typeof v === "string") ids.add(v);
    }
  }
  return [...ids];
}

export function buildingAccess(
  c: Context<AppEnv>,
  buildingId: string,
  permissionIds: readonly string[],
): boolean {
  const user = c.get("user");
  if (!user) return false;
  if (user.system === true) return true;
  if (hasSuperadmin(user)) return true;

  for (const p of user.permissions) {
    if (!permissionIds.includes(p.id)) continue;
    // `value: undefined` = global (by convention). Accept.
    if (!p.value) return true;
    for (const v of p.value) {
      if (typeof v === "string" && v === buildingId) return true;
    }
  }
  return false;
}
