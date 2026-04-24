import { collectScopeValues, hasPermission, scopedAccess } from "@s/shared/auth";
import type { UserContext } from "@s/shared/types";
import type { Context } from "hono";
import type { AppEnv } from "../types";

export function hasSuperadmin(user: UserContext): boolean {
  return hasPermission(user, "building_superadmin");
}

export const callerScopedBuildingIds = collectScopeValues;

export function buildingAccess(
  c: Context<AppEnv>,
  buildingId: string,
  permissionIds: readonly string[],
): boolean {
  const user = c.get("user");
  if (!user) return false;
  return scopedAccess(user, buildingId, permissionIds, {
    superadminPermission: "building_superadmin",
  });
}
