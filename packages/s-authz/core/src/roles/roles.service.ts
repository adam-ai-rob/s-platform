import { ConflictError, NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import type { Permission } from "@s/shared/types";
import { type AuthzRole, createAuthzRole } from "./roles.entity";
import { authzRolesRepository } from "./roles.repository";

export async function createRole(params: {
  name: string;
  description?: string;
  permissions?: Permission[];
  childRoleIds?: string[];
}): Promise<AuthzRole> {
  const existing = await authzRolesRepository.findByName(params.name);
  if (existing) throw new ConflictError(`Role "${params.name}" already exists`);

  const role = createAuthzRole(params);
  await authzRolesRepository.insert(role);
  logger.info("✅ Role created", { roleId: role.id, name: role.name });
  return role;
}

export async function getRole(id: string): Promise<AuthzRole> {
  const role = await authzRolesRepository.findById(id);
  if (!role) throw new NotFoundError(`Role ${id} not found`);
  return role;
}

export async function deleteRole(id: string): Promise<void> {
  const role = await authzRolesRepository.findById(id);
  if (!role) throw new NotFoundError(`Role ${id} not found`);
  if (role.system) throw new ConflictError("System roles cannot be deleted");
  await authzRolesRepository.delete(id);
  logger.info("🔒 Role deleted", { roleId: id });
}

// Permission resolution moved to `view/view.service.ts`
// (`resolvePermissionsForAssignments`) because it now needs the
// per-assignment `value` field, which wasn't available here.
