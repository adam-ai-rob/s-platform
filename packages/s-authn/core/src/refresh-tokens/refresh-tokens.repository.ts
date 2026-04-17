import { BaseRepository, type PaginatedResult } from "@s/shared/ddb";
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
