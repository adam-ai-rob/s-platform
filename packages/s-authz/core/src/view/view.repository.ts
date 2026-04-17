import { BaseRepository } from "@s/shared/ddb";
import type { AuthzViewEntry, AuthzViewEntryKeys } from "./view.entity";

function tableName(): string {
  const name = process.env.AUTHZ_VIEW_TABLE_NAME;
  if (!name) throw new Error("AUTHZ_VIEW_TABLE_NAME env var not set");
  return name;
}

class AuthzViewRepository extends BaseRepository<AuthzViewEntry, AuthzViewEntryKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "userId" },
    });
  }

  async findByUserId(userId: string): Promise<AuthzViewEntry | undefined> {
    return this.get(userId);
  }

  async replace(entry: AuthzViewEntry): Promise<void> {
    // Unconditional put — rebuild is always the authoritative write
    await this.put(entry);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.delete(userId);
  }
}

export const authzViewRepository = new AuthzViewRepository();
