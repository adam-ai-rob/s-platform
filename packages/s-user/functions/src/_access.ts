import { ForbiddenError } from "@s/shared/errors";

/**
 * Check if the caller has superadmin permission.
 *
 * This is a global permission that grants access to all admin routes.
 */
export function hasSuperadmin(user: { permissions: Array<{ id: string }> }): boolean {
  return user.permissions.some((p) => p.id === "user_superadmin");
}

/**
 * Require superadmin permission or throw 403.
 */
export function requireSuperadmin(user: { permissions: Array<{ id: string }> }) {
  if (!hasSuperadmin(user)) {
    throw new ForbiddenError("user_superadmin required");
  }
}
