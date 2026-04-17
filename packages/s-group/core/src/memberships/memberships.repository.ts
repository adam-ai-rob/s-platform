import { BaseRepository } from "@s/shared/ddb";
import {
  type GroupUser,
  type GroupUserKeys,
  type GroupUserRel,
  compositeId,
} from "./memberships.entity";

function tableName(): string {
  const name = process.env.GROUP_USERS_TABLE_NAME;
  if (!name) throw new Error("GROUP_USERS_TABLE_NAME env var not set");
  return name;
}

class GroupUsersRepository extends BaseRepository<GroupUser, GroupUserKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(
    groupId: string,
    userId: string,
    rel: GroupUserRel,
  ): Promise<GroupUser | undefined> {
    return this.get(compositeId(groupId, userId, rel));
  }

  async insert(entry: GroupUser): Promise<void> {
    await this.put(entry, { condition: "attribute_not_exists(id)" });
  }

  async listByGroup(groupId: string): Promise<GroupUser[]> {
    const results: GroupUser[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.queryByIndex("ByGroupId", "groupId", groupId, {
        limit: 100,
        nextToken,
      });
      results.push(...res.items);
      nextToken = res.nextToken;
    } while (nextToken);
    return results;
  }

  async listByUser(userId: string): Promise<GroupUser[]> {
    const results: GroupUser[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.queryByIndex("ByUserId", "userId", userId, {
        limit: 100,
        nextToken,
      });
      results.push(...res.items);
      nextToken = res.nextToken;
    } while (nextToken);
    return results;
  }

  async remove(groupId: string, userId: string, rel: GroupUserRel): Promise<void> {
    await this.delete(compositeId(groupId, userId, rel));
  }
}

export const groupUsersRepository = new GroupUsersRepository();
