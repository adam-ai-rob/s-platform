import type { Permission } from "@s/shared/types";
import { ulid } from "ulid";

/**
 * AuthzRole — a named bundle of permissions.
 *
 * `childRoleIds` enables role hierarchy (permissions cascade up) — not
 * resolved in Phase 1 (we treat the role's permissions array as the
 * full set). The field is preserved in the schema so Phase 2 can add
 * hierarchy resolution without a migration.
 *
 * `system: true` guards the role against accidental deletion via API.
 */
export interface AuthzRole {
  id: string; // ULID
  name: string; // GSI ByName
  description?: string;
  permissions: Permission[];
  childRoleIds: string[];
  system: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AuthzRoleKeys = { id: string };

export function createAuthzRole(params: {
  name: string;
  description?: string;
  permissions?: Permission[];
  childRoleIds?: string[];
  system?: boolean;
}): AuthzRole {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    name: params.name,
    description: params.description,
    permissions: params.permissions ?? [],
    childRoleIds: params.childRoleIds ?? [],
    system: params.system ?? false,
    createdAt: now,
    updatedAt: now,
  };
}
