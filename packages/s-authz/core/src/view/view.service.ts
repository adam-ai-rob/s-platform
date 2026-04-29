import { logger } from "@s/shared/logger";
import type { Permission } from "@s/shared/types";
import { authzRolesRepository } from "../roles/roles.repository";
import { type AuthzUserRole, assertUserRoleAssignmentCount } from "../user-roles/user-roles.entity";
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
 *
 * Scope handling — per-permission `value` is sourced from two places:
 *   1. The role template (`AuthzRole.permissions[i].value`) — static
 *      scope baked into the role definition.
 *   2. The user-role assignment (`AuthzUserRole.value`) — per-user
 *      scope set at assignment time.
 *
 * Rules:
 *   - If the role's permission template has no `value` field, it's a
 *     global permission. Assignment scope is ignored for that entry.
 *   - If the template has `value` (possibly empty), it's a
 *     scope-required permission. The assignment's `value` is unioned
 *     with the template `value` and persisted on the view.
 *   - Across multiple assignments that contribute the same permission
 *     id, values are unioned. The final view has exactly one entry per
 *     permission id.
 */
export async function rebuildViewForUser(userId: string): Promise<Permission[]> {
  const assignments = await authzUserRolesRepository.listByUserBounded(userId);
  assertUserRoleAssignmentCount(assignments.observedCount);

  const permissions = await resolvePermissionsForAssignments(assignments.items);

  const entry: AuthzViewEntry = {
    userId,
    permissions,
    updatedAt: new Date().toISOString(),
  };

  await authzViewRepository.replace(entry);

  logger.info("🔑 AuthzView rebuilt", {
    userId,
    assignmentCount: assignments.items.length,
    permissionCount: permissions.length,
  });

  return permissions;
}

/**
 * Resolve the merged permission set from a list of user-role
 * assignments. Handles scope merging per the rules in
 * `rebuildViewForUser`'s docstring.
 *
 * Exported for unit testing; callers outside this module should go
 * through `rebuildViewForUser`.
 */
export async function resolvePermissionsForAssignments(
  assignments: AuthzUserRole[],
): Promise<Permission[]> {
  const byId = new Map<string, Permission>();
  if (assignments.length === 0) return [];

  // Single deduped batch fetch instead of one round-trip per assignment.
  const rolesById = await authzRolesRepository.findByIds(assignments.map((a) => a.roleId));

  for (const assignment of assignments) {
    const role = rolesById.get(assignment.roleId);
    if (!role) continue;

    for (const templatePerm of role.permissions) {
      const isScoped = templatePerm.value !== undefined;
      const templateValues = templatePerm.value ?? [];
      const assignmentValues = assignment.value ?? [];

      const effectiveValues = isScoped ? [...templateValues, ...assignmentValues] : undefined;

      const existing = byId.get(templatePerm.id);
      if (!existing) {
        byId.set(
          templatePerm.id,
          effectiveValues
            ? { id: templatePerm.id, value: unique(effectiveValues) }
            : { id: templatePerm.id },
        );
        continue;
      }

      // An earlier assignment contributed this permission id already.
      // If either side has no `value`, the permission is global — drop
      // the value field entirely (most-permissive wins).
      if (existing.value === undefined || effectiveValues === undefined) {
        byId.set(templatePerm.id, { id: templatePerm.id });
        continue;
      }

      existing.value = unique([...existing.value, ...effectiveValues]);
    }
  }

  return Array.from(byId.values());
}

function unique(values: readonly unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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
