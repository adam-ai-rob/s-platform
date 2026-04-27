import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@s/shared/errors";
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  PasswordExpiredError,
  RefreshTokenExpiredError,
  InvalidTokenFormatError,
  RefreshTokenInvalidError,
  UserDisabledError,
  UserNotFoundError,
} from "../core/src/shared/errors";

describe("s-authn errors", () => {
  test("InvalidCredentialsError → 401 INVALID_CREDENTIALS", () => {
    const e = new InvalidCredentialsError();
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("INVALID_CREDENTIALS");
    expect(e instanceof UnauthorizedError).toBe(true);
    expect(e instanceof DomainError).toBe(true);
  });

  test("UserDisabledError → 403 USER_DISABLED", () => {
    const e = new UserDisabledError();
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe("USER_DISABLED");
    expect(e instanceof ForbiddenError).toBe(true);
  });

  test("EmailAlreadyExistsError → 409 EMAIL_ALREADY_EXISTS with email in message", () => {
    const e = new EmailAlreadyExistsError("alice@example.com");
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(e.message).toContain("alice@example.com");
    expect(e instanceof ConflictError).toBe(true);
  });

  test("PasswordExpiredError → 401 PASSWORD_EXPIRED", () => {
    const e = new PasswordExpiredError();
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("PASSWORD_EXPIRED");
  });

  test("RefreshTokenInvalidError → 401 REFRESH_TOKEN_INVALID", () => {
    const e = new RefreshTokenInvalidError();
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("REFRESH_TOKEN_INVALID");
  });

  test("RefreshTokenExpiredError → 401 REFRESH_TOKEN_EXPIRED", () => {
    const e = new RefreshTokenExpiredError();
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("REFRESH_TOKEN_EXPIRED");
  });

  test("UserNotFoundError → 404 USER_NOT_FOUND", () => {
    const e = new UserNotFoundError();
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("USER_NOT_FOUND");
    expect(e instanceof NotFoundError).toBe(true);
  });

  test("InvalidTokenFormatError → 401 INVALID_FORMAT", () => {
    const e = new InvalidTokenFormatError();
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("INVALID_FORMAT");
    expect(e instanceof UnauthorizedError).toBe(true);
  });
});
