import { ConflictError, NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { getRole } from "../roles/roles.service";
import { rebuildViewForUser } from "../view/view.service";
import { createAuthzUserRole } from "./user-roles.entity";
import { authzUserRolesRepository } from "./user-roles.repository";

export async function assignRoleToUser(params: {
  userId: string;
  roleId: string;
  createdBy: string;
}): Promise<void> {
  // Ensure role exists
  await getRole(params.roleId);

  const existing = await authzUserRolesRepository.findByUserAndRole(params.userId, params.roleId);
  if (existing) throw new ConflictError("Role already assigned to user");

  const entry = createAuthzUserRole(params);
  await authzUserRolesRepository.insert(entry);

  // Rebuild the user's AuthzView so the new permissions take effect
  await rebuildViewForUser(params.userId);

  logger.info("🔒 Role assigned", {
    userId: params.userId,
    roleId: params.roleId,
  });
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
