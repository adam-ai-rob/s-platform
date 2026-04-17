import { BaseRepository } from "@s/shared/ddb";
import type { AuthzUserRole, AuthzUserRoleKeys } from "./user-roles.entity";

function tableName(): string {
  const name = process.env.AUTHZ_USER_ROLES_TABLE_NAME;
  if (!name) throw new Error("AUTHZ_USER_ROLES_TABLE_NAME env var not set");
  return name;
}

class AuthzUserRolesRepository extends BaseRepository<AuthzUserRole, AuthzUserRoleKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async insert(entry: AuthzUserRole): Promise<void> {
    await this.put(entry);
  }

  async findByUserAndRole(userId: string, roleId: string): Promise<AuthzUserRole | undefined> {
    const { items } = await this.queryByIndex("ByUserId", "userId", userId, { limit: 100 });
    return items.find((u) => u.roleId === roleId);
  }

  async listByUser(userId: string): Promise<AuthzUserRole[]> {
    const results: AuthzUserRole[] = [];
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
}

export const authzUserRolesRepository = new AuthzUserRolesRepository();
