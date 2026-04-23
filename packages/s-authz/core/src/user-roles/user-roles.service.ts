import { NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { getRole } from "../roles/roles.service";
import { rebuildViewForUser } from "../view/view.service";
import { createAuthzUserRole, uniqueValues } from "./user-roles.entity";
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

  const existing = await authzUserRolesRepository.findByUserAndRole(params.userId, params.roleId);

  if (existing) {
    const existingValues = existing.value ?? [];
    const incoming = params.value ?? [];
    const merged = uniqueValues([...existingValues, ...incoming]);
    // Only write if the merged value is actually different — no-op
    // otherwise to keep reassignment cheap.
    const changed = merged.length !== existingValues.length;
    if (changed) {
      await authzUserRolesRepository.insert({
        ...existing,
        value: merged.length > 0 ? merged : undefined,
      });
      logger.info("🔒 Role scope extended", {
        userId: params.userId,
        roleId: params.roleId,
        addedCount: merged.length - existingValues.length,
      });
    }
  } else {
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
  const entries = await authzUserRolesRepository.listByUser(userId);
  return entries.map((e) => e.roleId);
}
