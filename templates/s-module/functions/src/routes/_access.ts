import { hasPermission, scopedAccess } from "@s/shared/auth";
import type { UserContext } from "@s/shared/types";

const SUPERADMIN_PERMISSION = "{module}_superadmin";

export function hasSuperadmin(user: UserContext): boolean {
  return hasPermission(user, SUPERADMIN_PERMISSION);
}

export function resourceAccess(
  user: UserContext,
  resourceId: string,
  permissionIds: readonly string[],
): boolean {
  return scopedAccess(user, resourceId, permissionIds, {
    superadminPermission: SUPERADMIN_PERMISSION,
  });
}
