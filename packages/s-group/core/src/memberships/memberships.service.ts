import { isConditionalCheckFailed } from "@s/shared/ddb";
import { ConflictError, NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { groupsRepository } from "../groups/groups.repository";
import { getGroup } from "../groups/groups.service";
import { type GroupUser, type GroupUserRel, createMembership } from "./memberships.entity";
import { groupUsersRepository } from "./memberships.repository";

export async function addUserToGroup(params: {
  groupId: string;
  userId: string;
  rel?: GroupUserRel;
  addedBy?: string;
}): Promise<GroupUser> {
  await getGroup(params.groupId); // 404 if group missing

  const rel = params.rel ?? "manual";
  const entry = createMembership({ ...params, rel });

  try {
    await groupUsersRepository.insert(entry);
    logger.info("🔒 User added to group", {
      userId: params.userId,
      groupId: params.groupId,
      rel,
    });
    return entry;
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw new ConflictError("User already in group with this relation");
    }
    throw err;
  }
}

export async function removeUserFromGroup(params: {
  groupId: string;
  userId: string;
  rel?: GroupUserRel;
}): Promise<void> {
  const rel = params.rel ?? "manual";
  const existing = await groupUsersRepository.findById(params.groupId, params.userId, rel);
  if (!existing) throw new NotFoundError("Membership not found");

  await groupUsersRepository.remove(params.groupId, params.userId, rel);
  logger.info("🔒 User removed from group", {
    userId: params.userId,
    groupId: params.groupId,
    rel,
  });
}

export async function listGroupsForUser(userId: string): Promise<GroupUser[]> {
  const { items } = await groupUsersRepository.listByUser(userId);
  return items;
}

/**
 * Called by the event handler on `user.registered`.
 *
 * Scans all groups with auto-assignment enabled and adds the user to
 * every group whose `emailDomainNames` contains the user's domain.
 *
 * Idempotent — duplicate insertion is caught and ignored.
 */
export async function autoAssignUserByEmail(userId: string, email: string): Promise<void> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return;

  const candidates = await groupsRepository.listAutoAssignGroups();
  for (const g of candidates) {
    if (!g.emailDomainNames.includes(domain)) continue;
    const entry = createMembership({ groupId: g.id, userId, rel: "domain" });
    try {
      await groupUsersRepository.insert(entry);
      logger.info("🔒 User auto-assigned to group by domain", {
        userId,
        groupId: g.id,
        domain,
      });
    } catch (err) {
      if (isConditionalCheckFailed(err)) continue;
      throw err;
    }
  }
}
