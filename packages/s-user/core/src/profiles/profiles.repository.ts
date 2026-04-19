import { BaseRepository } from "@s/shared/ddb";
import type { UserProfile, UserProfileKeys } from "./profiles.entity";

function tableName(): string {
  const name = process.env.USER_PROFILES_TABLE_NAME;
  if (!name) throw new Error("USER_PROFILES_TABLE_NAME env var not set");
  return name;
}

class UserProfilesRepository extends BaseRepository<UserProfile, UserProfileKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "userId" },
    });
  }

  async findById(userId: string): Promise<UserProfile | undefined> {
    return this.get(userId);
  }

  async insert(profile: UserProfile): Promise<void> {
    // Conditional insert so the `user.registered` event handler is idempotent
    await this.put(profile, { condition: "attribute_not_exists(userId)" });
  }

  async update(
    userId: string,
    patch: Partial<Omit<UserProfile, "userId" | "createdAt">>,
  ): Promise<void> {
    await this.patch(userId, undefined, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}

export const userProfilesRepository = new UserProfilesRepository();
