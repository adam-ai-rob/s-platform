import { ulid } from "ulid";

/**
 * AuthnUser — the platform's identity record.
 *
 * `passwordHash` is optional: accounts can be created without a password
 * (e.g., for magic-link-only login in Phase 2). `system: true` marks
 * service/admin accounts (bootstrap gate).
 */
export interface AuthnUser {
  id: string; // ULID — partition key
  email: string; // GSI ByEmail
  passwordHash?: string; // argon2id
  emailVerified: boolean;
  enabled: boolean;
  passwordExpired: boolean;
  system: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export type AuthnUserKeys = { id: string };

export function createAuthnUser(params: {
  email: string;
  passwordHash?: string;
  system?: boolean;
}): AuthnUser {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    email: params.email.toLowerCase().trim(),
    passwordHash: params.passwordHash,
    emailVerified: false,
    enabled: true,
    passwordExpired: false,
    system: params.system ?? false,
    createdAt: now,
    updatedAt: now,
  };
}
