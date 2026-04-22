import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { BaseRepository, getDdbClient } from "@s/shared/ddb";
import type { UserProfile, UserProfileKeys } from "./profiles.entity";

function tableName(): string {
  const name = process.env.USER_PROFILES_TABLE_NAME;
  if (!name) throw new Error("USER_PROFILES_TABLE_NAME env var not set");
  return name;
}

export interface ScanPage {
  items: UserProfile[];
  lastKey?: Record<string, unknown>;
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

  /**
   * Full-table scan page. Only used by the backfill Lambda — normal
   * application flows never scan. Batched so a single Lambda invocation
   * can process a bounded chunk and return a resume key for the next call.
   */
  async scanPage(startKey: Record<string, unknown> | undefined, limit: number): Promise<ScanPage> {
    const response = await getDdbClient().send(
      new ScanCommand({
        TableName: tableName(),
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    return {
      items: (response.Items ?? []) as UserProfile[],
      lastKey: response.LastEvaluatedKey,
    };
  }
}

export const userProfilesRepository = new UserProfilesRepository();
