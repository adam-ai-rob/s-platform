import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { logger } from "@s/shared/logger";
import type { AuthnRefreshToken } from "../refresh-tokens/refresh-tokens.entity";
import { authnRefreshTokensRepository } from "../refresh-tokens/refresh-tokens.repository";
import {
  InvalidCredentialsError,
  PasswordExpiredError,
  RefreshTokenExpiredError,
  RefreshTokenInvalidError,
  UserDisabledError,
  UserNotFoundError,
} from "../shared/errors";
import { issueAccessToken, issueRefreshToken } from "../tokens/token.service";
import { createAuthnUser } from "../users/users.entity";
import { authnUsersRepository } from "../users/users.repository";

/**
 * Core auth flows: register, login, refresh, logout, change-password.
 *
 * Phase 2 flows (magic link, password reset, email verify) are deferred.
 *
 * Events (user.registered, user.enabled, user.disabled, user.password.changed)
 * are emitted via DDB Streams → stream-handler, not via direct publishEvent
 * calls here. The source of truth is the DB write.
 */

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(params: {
  email: string;
  password: string;
}): Promise<void> {
  // 1. Hash the password immediately.
  // We do this BEFORE the DB check to maintain constant response timing
  // between new registrations and duplicate attempts.
  const passwordHash = await argon2Hash(params.password);

  // 2. Check for existence.
  const existing = await authnUsersRepository.findByEmail(params.email);
  if (existing) {
    // Avoid user enumeration: do not throw EmailAlreadyExistsError.
    // Log internally but return success to the caller.
    logger.info("ℹ️ Registration attempted with existing email (ignored)", {
      email: params.email,
    });
    return;
  }

  // 3. Create and insert.
  const user = createAuthnUser({ email: params.email, passwordHash });
  await authnUsersRepository.insert(user);

  logger.info("✅ User registered", { userId: user.id, email: user.email });
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(params: {
  email: string;
  password: string;
}): Promise<TokenResponse> {
  const user = await authnUsersRepository.findByEmail(params.email);
  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const ok = await argon2Verify(user.passwordHash, params.password);
  if (!ok) throw new InvalidCredentialsError();

  if (!user.enabled) throw new UserDisabledError();
  if (user.passwordExpired) throw new PasswordExpiredError();

  const [accessToken, refresh] = await Promise.all([
    issueAccessToken(user.id),
    issueRefreshToken(user.id),
  ]);
  await persistRefreshToken(user.id, refresh);

  logger.info("🔒 login", {
    action: "login",
    success: true,
    userId: user.id,
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: 3600,
  };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh(params: {
  userId: string; // from verified JWT payload (sub)
  tokenId: string; // JTI (refresh token record id)
  rawToken: string; // raw JWT string, verified against stored hash
}): Promise<TokenResponse> {
  const stored = await authnRefreshTokensRepository.findById(params.tokenId);

  if (!stored || stored.userId !== params.userId || stored.revokedAt) {
    throw new RefreshTokenInvalidError();
  }

  if (new Date(stored.expiresAt) < new Date()) {
    throw new RefreshTokenExpiredError();
  }

  const hashOk = await argon2Verify(stored.tokenHash, params.rawToken);
  if (!hashOk) throw new RefreshTokenInvalidError();

  const user = await authnUsersRepository.findById(params.userId);
  if (!user || !user.enabled) throw new UserDisabledError();

  const [accessToken, newRefresh] = await Promise.all([
    issueAccessToken(user.id),
    issueRefreshToken(user.id),
  ]);

  const tokenHash = await argon2Hash(newRefresh.token);
  const newEntity: AuthnRefreshToken = {
    id: newRefresh.jti,
    userId: user.id,
    tokenHash,
    createdAt: new Date().toISOString(),
    expiresAt: newRefresh.expiresAt.toISOString(),
    expiresAtEpoch: Math.floor(newRefresh.expiresAt.getTime() / 1000),
  };

  try {
    await authnRefreshTokensRepository.rotate(params.tokenId, newEntity);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === "TransactionCanceledException" ||
        (err as { __type?: string }).__type?.includes("TransactionCanceledException") === true)
    ) {
      throw new RefreshTokenInvalidError();
    }
    throw err;
  }

  logger.info("🔒 refresh", {
    action: "refresh",
    success: true,
    userId: params.userId,
  });

  return { accessToken, refreshToken: newRefresh.token, expiresIn: 3600 };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(params: {
  userId: string;
  tokenId: string;
}): Promise<void> {
  await authnRefreshTokensRepository.revoke(params.tokenId);
  logger.info("🔒 logout", {
    action: "logout",
    success: true,
    userId: params.userId,
  });
}

// ─── Change password ──────────────────────────────────────────────────────────

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const user = await authnUsersRepository.findById(params.userId);
  if (!user) throw new UserNotFoundError();
  if (!user.passwordHash) throw new InvalidCredentialsError();

  const ok = await argon2Verify(user.passwordHash, params.currentPassword);
  if (!ok) throw new InvalidCredentialsError();

  const newHash = await argon2Hash(params.newPassword);
  await authnUsersRepository.update(params.userId, {
    passwordHash: newHash,
    passwordExpired: false,
  });

  logger.info("🔒 password.changed", {
    action: "password.changed",
    success: true,
    userId: params.userId,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function persistRefreshToken(
  userId: string,
  refresh: { token: string; jti: string; expiresAt: Date },
): Promise<void> {
  const tokenHash = await argon2Hash(refresh.token);
  const entity: AuthnRefreshToken = {
    id: refresh.jti,
    userId,
    tokenHash,
    createdAt: new Date().toISOString(),
    expiresAt: refresh.expiresAt.toISOString(),
    expiresAtEpoch: Math.floor(refresh.expiresAt.getTime() / 1000),
  };
  await authnRefreshTokensRepository.insert(entity);
}
