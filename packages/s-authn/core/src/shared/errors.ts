import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@s/shared/errors";

/**
 * s-authn-specific error subclasses.
 *
 * Override `code` on the base error so CloudWatch queries can filter by
 * the authn-specific codes (e.g., INVALID_CREDENTIALS) rather than just
 * UNAUTHORIZED.
 */

export class InvalidCredentialsError extends UnauthorizedError {
  override readonly code = "INVALID_CREDENTIALS";
  constructor() {
    super("Invalid email or password");
  }
}

export class PasswordExpiredError extends UnauthorizedError {
  override readonly code = "PASSWORD_EXPIRED";
  constructor() {
    super("Password has expired; please reset");
  }
}

export class UserDisabledError extends ForbiddenError {
  override readonly code = "USER_DISABLED";
  constructor() {
    super("Account is disabled");
  }
}

export class EmailAlreadyExistsError extends ConflictError {
  override readonly code = "EMAIL_ALREADY_EXISTS";
  constructor(email: string) {
    super(`User with email ${email} already exists`);
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  override readonly code = "REFRESH_TOKEN_INVALID";
  constructor() {
    super("Refresh token is invalid or revoked");
  }
}

export class RefreshTokenExpiredError extends UnauthorizedError {
  override readonly code = "REFRESH_TOKEN_EXPIRED";
  constructor() {
    super("Refresh token has expired");
  }
}

export class RefreshTokenMalformedError extends UnauthorizedError {
  override readonly code = "REFRESH_TOKEN_MALFORMED";
  constructor() {
    super("Refresh token is malformed");
  }
}

export class MissingRefreshTokenIdError extends ValidationError {
  override readonly code = "MISSING_REFRESH_JTI";
  constructor() {
    super("X-Refresh-JTI header required for logout");
  }
}

export class UserNotFoundError extends NotFoundError {
  override readonly code = "USER_NOT_FOUND";
  constructor() {
    super("User not found");
  }
}
