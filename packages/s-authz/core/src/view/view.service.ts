import { logger } from "@s/shared/logger";
import type { Permission } from "@s/shared/types";
import { resolvePermissions } from "../roles/roles.service";
import { authzUserRolesRepository } from "../user-roles/user-roles.repository";
import type { AuthzViewEntry } from "./view.entity";
import { authzViewRepository } from "./view.repository";

/**
 * Rebuild a user's materialized `AuthzView`.
 *
 * Called from:
 *   - Role assignment/unassignment services (user-roles.service)
 *   - Event handler on `user.registered` (creates an empty entry)
 *   - Event handler on `user.enabled` / `user.disabled`
 *   - Event handler on `group.user.activated` / `group.user.deactivated`
 *     (future — requires s-group integration)
 */
export async function rebuildViewForUser(userId: string): Promise<Permission[]> {
  // Phase 1: only direct user→role assignments.
  // Phase 2: + group→role assignments once s-group integration is live.
  const userRoleEntries = await authzUserRolesRepository.listByUser(userId);
  const roleIds = userRoleEntries.map((e) => e.roleId);

  const permissions = await resolvePermissions(roleIds);

  const entry: AuthzViewEntry = {
    userId,
    permissions,
    updatedAt: new Date().toISOString(),
  };

  await authzViewRepository.replace(entry);

  logger.info("🔑 AuthzView rebuilt", {
    userId,
    roleCount: roleIds.length,
    permissionCount: permissions.length,
  });

  return permissions;
}

/**
 * Clear all permissions for a user (used on `user.disabled`).
 * Leaves the entry in place with `permissions: []` so middleware still
 * loads it and returns a consistent empty list.
 */
export async function clearViewForUser(userId: string): Promise<void> {
  const entry: AuthzViewEntry = {
    userId,
    permissions: [],
    updatedAt: new Date().toISOString(),
  };
  await authzViewRepository.replace(entry);
  logger.info("🔒 AuthzView cleared", { userId });
}

/**
 * Create an initial (empty) view entry for a newly registered user.
 * Idempotent — if it already exists we just overwrite with empty.
 */
export async function initViewForUser(userId: string): Promise<void> {
  await rebuildViewForUser(userId);
}

export async function getPermissionsForUser(userId: string): Promise<Permission[]> {
  const entry = await authzViewRepository.findByUserId(userId);
  return entry?.permissions ?? [];
}
