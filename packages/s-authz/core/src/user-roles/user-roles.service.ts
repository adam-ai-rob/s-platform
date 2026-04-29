import { NotFoundError, ValidationError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { getRole } from "../roles/roles.service";
import { rebuildViewForUser } from "../view/view.service";
import {
  MAX_USER_ROLE_ASSIGNMENTS,
  assertUserRoleAssignmentCount,
  createAuthzUserRole,
  normalizeAssignmentValue,
} from "./user-roles.entity";
import { authzUserRolesRepository } from "./user-roles.repository";

/**
 * Assign a role to a user, optionally with a scope `value`.
 *
 * Idempotent: re-assigning the same role to the same user **unions**
 * the incoming `value` with whatever's already stored on the row. This
 * matches the "one row per (userId, roleId)" storage model — the row's
 * `value` field accumulates every scope a user has been granted for
 * that role.
 *
 * Scope-free assignments (e.g. `building-superadmin`) ignore the
 * `value` argument downstream — see `rebuildViewForUser`.
 */
export async function assignRoleToUser(params: {
  userId: string;
  roleId: string;
  value?: unknown[];
  createdBy: string;
}): Promise<void> {
  await getRole(params.roleId);

  const assignments = await authzUserRolesRepository.listByUserBounded(params.userId);
  assertUserRoleAssignmentCount(assignments.observedCount);

  const existing = assignments.items.find((u) => u.roleId === params.roleId);

  if (existing) {
    const existingValues = existing.value ?? [];
    const existingSet = new Set(existingValues);
    const incoming = params.value ?? [];
    // Set-based check: write iff the incoming batch contains at least one
    // value not already present. `uniqueValues` alone is fragile — if a
    // legacy row happens to contain duplicates, a length-based check can
    // silently misreport "changed" in either direction.
    const addedValues = incoming.filter((v) => !existingSet.has(v));
    if (addedValues.length === 0) {
      // True no-op: identical re-assignment. Skip the DynamoDB write AND
      // the view rebuild — nothing would change.
      return;
    }
    const merged = normalizeAssignmentValue([...existingValues, ...addedValues]);
    await authzUserRolesRepository.insert({
      ...existing,
      value: merged,
    });
    logger.info("🔒 Role scope extended", {
      userId: params.userId,
      roleId: params.roleId,
      addedCount: addedValues.length,
    });
  } else {
    if (assignments.items.length >= MAX_USER_ROLE_ASSIGNMENTS) {
      throw new ValidationError(
        `User can have at most ${MAX_USER_ROLE_ASSIGNMENTS} role assignments`,
      );
    }

    const entry = createAuthzUserRole(params);
    await authzUserRolesRepository.insert(entry);
    logger.info("🔒 Role assigned", {
      userId: params.userId,
      roleId: params.roleId,
      valueCount: entry.value?.length ?? 0,
    });
  }

  await rebuildViewForUser(params.userId);
}

export async function unassignRoleFromUser(params: {
  userId: string;
  roleId: string;
}): Promise<void> {
  const existing = await authzUserRolesRepository.findByUserAndRole(params.userId, params.roleId);
  if (!existing) throw new NotFoundError("Role assignment not found");

  await authzUserRolesRepository.delete(existing.id);
  await rebuildViewForUser(params.userId);

  logger.info("🔒 Role unassigned", {
    userId: params.userId,
    roleId: params.roleId,
  });
}

export async function listRolesForUser(userId: string): Promise<string[]> {
  const assignments = await authzUserRolesRepository.listByUserBounded(userId);
  return assignments.items.map((e) => e.roleId);
}
