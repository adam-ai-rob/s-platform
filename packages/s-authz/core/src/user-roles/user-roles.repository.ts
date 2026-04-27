import { BaseRepository, type PaginatedResult } from "@s/shared/ddb";
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

  async listByUser(
    userId: string,
    options: { limit?: number; nextToken?: string } = {},
  ): Promise<PaginatedResult<AuthzUserRole>> {
    return this.queryByIndex("ByUserId", "userId", userId, {
      limit: 100,
      ...options,
    });
  }
}

export const authzUserRolesRepository = new AuthzUserRolesRepository();
