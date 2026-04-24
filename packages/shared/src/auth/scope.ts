import type { UserContext } from "../types/index";

export interface ScopedAccessOptions {
  superadminPermission?: string;
}

export function hasPermission(user: UserContext, permissionId: string): boolean {
  return user.permissions.some((permission) => permission.id === permissionId);
}

export function collectScopeValues(user: UserContext, permissionIds: readonly string[]): string[] {
  const values = new Set<string>();
  for (const permission of user.permissions) {
    if (!permissionIds.includes(permission.id)) continue;
    if (!permission.value) continue;
    for (const value of permission.value) {
      if (typeof value === "string") values.add(value);
    }
  }
  return [...values];
}

export function scopedAccess(
  user: UserContext,
  resourceId: string,
  permissionIds: readonly string[],
  options: ScopedAccessOptions = {},
): boolean {
  if (user.system === true) return true;
  if (options.superadminPermission && hasPermission(user, options.superadminPermission))
    return true;

  for (const permission of user.permissions) {
    if (!permissionIds.includes(permission.id)) continue;
    if (!permission.value) return true;
    for (const value of permission.value) {
      if (typeof value === "string" && value === resourceId) return true;
    }
  }
  return false;
}
