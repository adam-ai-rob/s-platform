import { logger } from "@s/shared/logger";
import type { Permission } from "@s/shared/types";
import { createAuthzRole } from "../roles/roles.entity";
import { authzRolesRepository } from "../roles/roles.repository";

/**
 * Declarative system-role seed set.
 *
 * Each entry is an idempotent role definition: if a role with the same
 * `name` already exists, it's skipped. Otherwise a new row is inserted
 * with `system: true` so it can't be deleted via the admin API.
 *
 * Permission template convention:
 *   - `{ id: "X" }` (no `value` field)         → **global** permission.
 *     The user-role assignment's `value` is ignored for this entry.
 *   - `{ id: "X", value: [] }` (empty array)    → **scope-required**
 *     permission. The assignment's `value` is merged in at rebuild time
 *     (see `resolvePermissionsForAssignments`).
 *
 * See [`docs/architecture/04-authentication-and-authorization.md`](../../../../../docs/architecture/04-authentication-and-authorization.md)
 * for the full model.
 */
export interface SystemRoleSpec {
  name: string;
  description: string;
  permissions: Permission[];
}

export const BUILDING_SYSTEM_ROLES: readonly SystemRoleSpec[] = [
  {
    name: "building-superadmin",
    description: "Full access to every building, any status. Global, unscoped.",
    permissions: [{ id: "building_superadmin" }],
  },
  {
    name: "building-admin",
    description: "Full CRUD on buildings in the assignment's value scope.",
    permissions: [{ id: "building_admin", value: [] }],
  },
  {
    name: "building-manager",
    description:
      "Read + update on buildings in the assignment's value scope. Cannot delete or archive.",
    permissions: [{ id: "building_manager", value: [] }],
  },
  {
    name: "building-user",
    description: "Read active buildings in the assignment's value scope.",
    permissions: [{ id: "building_user", value: [] }],
  },
] as const;

/**
 * All system-role seeds this module owns. Extend by appending to this
 * array — the seed Lambda walks every entry in one invocation.
 */
export const SYSTEM_ROLES: readonly SystemRoleSpec[] = [...BUILDING_SYSTEM_ROLES];

/**
 * Ensure every system role exists. Idempotent — existing roles (matched
 * by `name`) are left alone. Returns a summary of what changed.
 */
export async function seedSystemRoles(): Promise<{
  created: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const spec of SYSTEM_ROLES) {
    const existing = await authzRolesRepository.findByName(spec.name);
    if (existing) {
      skipped.push(spec.name);
      continue;
    }
    const role = createAuthzRole({
      name: spec.name,
      description: spec.description,
      permissions: [...spec.permissions],
      system: true,
    });
    await authzRolesRepository.insert(role);
    created.push(spec.name);
  }

  logger.info("🌱 System roles seeded", {
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
  });

  return { created, skipped };
}
