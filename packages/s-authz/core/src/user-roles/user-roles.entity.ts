import { ulid } from "ulid";

/**
 * AuthzUserRole — an individual user ↔ role assignment.
 *
 * `value` is the per-assignment scope that flows into every
 * scope-requiring permission on the role's template (i.e. permissions
 * whose template carries a `value: []` marker). For permissions with no
 * value marker on the template, this field is ignored.
 *
 * Example:
 *   Assigning `building-admin` (template: `[{ id: "building_admin",
 *   value: [] }]`) to Alice with `value: ["bld-A", "bld-B"]` yields
 *   `{ id: "building_admin", value: ["bld-A", "bld-B"] }` in Alice's
 *   AuthzView.
 *
 * Reassignment unions the incoming `value` with whatever's already on
 * the row — see `assignRoleToUser`. Unique values only; order is not
 * preserved.
 */
export interface AuthzUserRole {
  id: string; // ULID
  userId: string;
  roleId: string;
  value?: unknown[];
  createdAt: string;
  createdBy: string;
}

export type AuthzUserRoleKeys = { id: string };

export function createAuthzUserRole(params: {
  userId: string;
  roleId: string;
  value?: unknown[];
  createdBy: string;
}): AuthzUserRole {
  return {
    id: ulid(),
    userId: params.userId,
    roleId: params.roleId,
    ...(params.value && params.value.length > 0 ? { value: uniqueValues(params.value) } : {}),
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
  };
}

/**
 * De-duplicates a value array while preserving first-seen order.
 * Used when persisting an assignment so the stored row never contains
 * duplicates.
 */
export function uniqueValues(values: readonly unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
