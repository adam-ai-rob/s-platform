import { BaseRepository, type PaginatedResult } from "@s/shared/ddb";
import type { AuthnUser, AuthnUserKeys } from "./users.entity";

function tableName(): string {
  const name = process.env.AUTHN_USERS_TABLE_NAME;
  if (!name) throw new Error("AUTHN_USERS_TABLE_NAME env var not set");
  return name;
}

/**
 * AuthnUsers — primary identity table.
 *
 * - `id` ULID partition key
 * - `ByEmail` GSI for login lookups
 */
class AuthnUsersRepository extends BaseRepository<AuthnUser, AuthnUserKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(id: string): Promise<AuthnUser | undefined> {
    return this.get(id);
  }

  async findByEmail(email: string): Promise<AuthnUser | undefined> {
    const { items } = await this.queryByIndex("ByEmail", "email", email.toLowerCase().trim(), {
      limit: 1,
    });
    return items[0];
  }

  async insert(user: AuthnUser): Promise<void> {
    await this.put(user, { condition: "attribute_not_exists(id)" });
  }

  async update(id: string, patch: Partial<Omit<AuthnUser, "id" | "createdAt">>): Promise<void> {
    await this.patch(id, undefined, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  async list(options: {
    limit?: number;
    nextToken?: string;
  }): Promise<PaginatedResult<AuthnUser>> {
    return this.queryByIndex("ByEmail", "email", "", options);
  }
}

export const authnUsersRepository = new AuthnUsersRepository();
