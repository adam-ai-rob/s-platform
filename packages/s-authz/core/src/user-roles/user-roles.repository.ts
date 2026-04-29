import { BaseRepository } from "@s/shared/ddb";
import {
  type AuthzUserRole,
  type AuthzUserRoleKeys,
  MAX_USER_ROLE_ASSIGNMENTS,
} from "./user-roles.entity";

export interface BoundedUserRolesResult {
  items: AuthzUserRole[];
  observedCount: number;
  overLimit: boolean;
}

export interface BoundedUserRoleLookup {
  assignment: AuthzUserRole | undefined;
  observedCount: number;
  overLimit: boolean;
}

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

  async findByUserAndRole(userId: string, roleId: string): Promise<BoundedUserRoleLookup> {
    const result = await this.listByUserBounded(userId);
    return {
      assignment: result.items.find((u) => u.roleId === roleId),
      observedCount: result.observedCount,
      overLimit: result.overLimit,
    };
  }

  async listByUserBounded(
    userId: string,
    maxItems = MAX_USER_ROLE_ASSIGNMENTS,
  ): Promise<BoundedUserRolesResult> {
    const results: AuthzUserRole[] = [];
    let nextToken: string | undefined;
    do {
      const remaining = maxItems + 1 - results.length;
      if (remaining <= 0) break;

      const res = await this.queryByIndex("ByUserId", "userId", userId, {
        limit: remaining,
        nextToken,
      });
      results.push(...res.items);
      nextToken = res.nextToken;
    } while (nextToken && results.length <= maxItems);

    return {
      items: results.slice(0, maxItems),
      observedCount: results.length,
      overLimit: results.length > maxItems,
    };
  }
}

export const authzUserRolesRepository = new AuthzUserRolesRepository();
