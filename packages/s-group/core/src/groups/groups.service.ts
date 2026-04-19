import { ConflictError, NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { type Group, createGroup } from "./groups.entity";
import { groupsRepository } from "./groups.repository";

export async function createNewGroup(params: {
  name: string;
  description?: string;
  type?: "company" | "team" | "building";
  emailDomainNames?: string[];
  automaticUserAssignment?: boolean;
}): Promise<Group> {
  const existing = await groupsRepository.findByName(params.name);
  if (existing) throw new ConflictError(`Group "${params.name}" already exists`);

  const group = createGroup(params);
  await groupsRepository.insert(group);
  logger.info("✅ Group created", { groupId: group.id, name: group.name });
  return group;
}

export async function getGroup(id: string): Promise<Group> {
  const group = await groupsRepository.findById(id);
  if (!group) throw new NotFoundError(`Group ${id} not found`);
  return group;
}

export async function deleteGroup(id: string): Promise<void> {
  const group = await groupsRepository.findById(id);
  if (!group) throw new NotFoundError(`Group ${id} not found`);
  await groupsRepository.delete(id);
  logger.info("🔒 Group deleted", { groupId: id });
}
