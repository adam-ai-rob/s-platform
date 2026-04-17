/**
 * GroupUser — a membership record.
 *
 * `id` is composite: `{groupId}#{userId}#{rel}` so a user can be in
 * the same group multiple times with different rels (manual add +
 * domain auto-assignment, for instance).
 *
 * `rel`:
 *   - `manual`  — added by an admin via API
 *   - `domain`  — auto-assigned via email domain match on user.registered
 *   - `owner`   — the group's master owner (Phase 2)
 *   - `group`   — cascade from a child group (Phase 2)
 */

export type GroupUserRel = "owner" | "manual" | "domain" | "group";
export type GroupUserStatus = "active" | "pending" | "rejected";

export interface GroupUser {
  id: string;
  groupId: string;
  userId: string;
  rel: GroupUserRel;
  status: GroupUserStatus;
  addedBy?: string; // userId of admin; blank for rel=domain
  createdAt: string;
  updatedAt: string;
}

export type GroupUserKeys = { id: string };

export function compositeId(groupId: string, userId: string, rel: GroupUserRel): string {
  return `${groupId}#${userId}#${rel}`;
}

export function createMembership(params: {
  groupId: string;
  userId: string;
  rel: GroupUserRel;
  addedBy?: string;
}): GroupUser {
  const now = new Date().toISOString();
  return {
    id: compositeId(params.groupId, params.userId, params.rel),
    groupId: params.groupId,
    userId: params.userId,
    rel: params.rel,
    status: "active",
    addedBy: params.addedBy,
    createdAt: now,
    updatedAt: now,
  };
}
