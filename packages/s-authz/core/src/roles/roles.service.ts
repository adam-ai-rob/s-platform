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

/**
 * Given a set of role IDs, return the merged permission list.
 *
 * Phase 1: flat union of each role's direct `permissions` array.
 * Phase 2: recursively resolve `childRoleIds` and merge value-scoped
 * permissions (dedupe by `id`, union `value` arrays).
 */
export async function resolvePermissions(roleIds: string[]): Promise<Permission[]> {
  const byId = new Map<string, Permission>();
  for (const roleId of roleIds) {
    const role = await authzRolesRepository.findById(roleId);
    if (!role) continue;
    for (const perm of role.permissions) {
      if (!byId.has(perm.id)) {
        byId.set(perm.id, { id: perm.id, ...(perm.value ? { value: [...perm.value] } : {}) });
        continue;
      }
      const merged = byId.get(perm.id);
      if (!merged || !perm.value) continue;
      const existingValues = merged.value ?? [];
      const union = [...new Set([...existingValues, ...perm.value])];
      merged.value = union;
    }
  }
  return Array.from(byId.values());
}
