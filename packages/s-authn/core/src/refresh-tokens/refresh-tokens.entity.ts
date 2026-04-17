/**
 * AuthnRefreshToken — persistent record of an issued refresh token.
 *
 * `id` is the JWT `jti` claim (ULID). `tokenHash` is argon2id over the
 * raw JWT string so a leaked DB dump can't be used to forge refresh.
 *
 * `expiresAt` is an ISO string for app-layer checks; `expiresAtEpoch` is
 * the Unix seconds value used by DynamoDB's TTL attribute.
 */
export interface AuthnRefreshToken {
  id: string; // JTI (ULID) — partition key
  userId: string; // GSI ByUserId
  tokenHash: string; // argon2id hash of the raw JWT
  createdAt: string; // ISO 8601 — sort key on ByUserId
  expiresAt: string; // ISO 8601
  expiresAtEpoch: number; // Unix seconds — DDB TTL attribute
  revokedAt?: string; // ISO 8601 when revoked
}

export type AuthnRefreshTokenKeys = { id: string };
