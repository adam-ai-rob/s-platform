import { BaseRepository, type PaginatedResult } from "@s/shared/ddb";
import type { AuthzRole, AuthzRoleKeys } from "./roles.entity";

function tableName(): string {
  const name = process.env.AUTHZ_ROLES_TABLE_NAME;
  if (!name) throw new Error("AUTHZ_ROLES_TABLE_NAME env var not set");
  return name;
}

class AuthzRolesRepository extends BaseRepository<AuthzRole, AuthzRoleKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(id: string): Promise<AuthzRole | undefined> {
    return this.get(id);
  }

  async findByName(name: string): Promise<AuthzRole | undefined> {
    const { items } = await this.queryByIndex("ByName", "name", name, { limit: 1 });
    return items[0];
  }

  async insert(role: AuthzRole): Promise<void> {
    await this.put(role, { condition: "attribute_not_exists(id)" });
  }

  async update(id: string, patch: Partial<Omit<AuthzRole, "id" | "createdAt">>): Promise<void> {
    await this.patch(id, undefined, { ...patch, updatedAt: new Date().toISOString() });
  }

  async list(options: { limit?: number; nextToken?: string }): Promise<PaginatedResult<AuthzRole>> {
    // GSI scan via ByName. For a true "list all" we'd use a sparse full-table
    // attribute, but Phase 1 treats role catalog as small enough to scan.
    return this.queryByIndex("ByName", "name", "", options);
  }
}

export const authzRolesRepository = new AuthzRolesRepository();
