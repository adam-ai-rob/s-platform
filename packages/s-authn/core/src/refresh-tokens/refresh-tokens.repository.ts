import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { BaseRepository, type PaginatedResult, getDdbClient } from "@s/shared/ddb";
import type { AuthnRefreshToken, AuthnRefreshTokenKeys } from "./refresh-tokens.entity";

function tableName(): string {
  const name = process.env.AUTHN_REFRESH_TOKENS_TABLE_NAME;
  if (!name) throw new Error("AUTHN_REFRESH_TOKENS_TABLE_NAME env var not set");
  return name;
}

class AuthnRefreshTokensRepository extends BaseRepository<
  AuthnRefreshToken,
  AuthnRefreshTokenKeys
> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(id: string): Promise<AuthnRefreshToken | undefined> {
    return this.get(id);
  }

  async insert(token: AuthnRefreshToken): Promise<void> {
    await this.put(token);
  }

  async revoke(id: string): Promise<void> {
    await this.patch(id, undefined, {
      revokedAt: new Date().toISOString(),
    } as Partial<AuthnRefreshToken>);
  }

  async rotate(oldTokenId: string, newToken: AuthnRefreshToken): Promise<void> {
    await getDdbClient().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { id: oldTokenId },
              UpdateExpression: "SET #revokedAt = :revokedAt",
              ExpressionAttributeNames: { "#revokedAt": "revokedAt" },
              ExpressionAttributeValues: { ":revokedAt": new Date().toISOString() },
              ConditionExpression: "attribute_exists(id) AND attribute_not_exists(#revokedAt)",
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: newToken as unknown as Record<string, unknown>,
              ConditionExpression: "attribute_not_exists(id)",
            },
          },
        ],
      }),
    );
  }

  async listActiveForUser(
    userId: string,
    options: { limit?: number; nextToken?: string } = {},
  ): Promise<PaginatedResult<AuthnRefreshToken>> {
    return this.queryByIndex("ByUserId", "userId", userId, {
      ...options,
      scanIndexForward: false, // newest first
    });
  }
}

export const authnRefreshTokensRepository = new AuthnRefreshTokensRepository();
