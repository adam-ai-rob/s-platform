import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./domain-error";

describe("DomainError hierarchy", () => {
  test("base DomainError carries code, message, statusCode, details", () => {
    const err = new DomainError("SOME_CODE", "bad things", 418, { extra: 1 });
    expect(err.code).toBe("SOME_CODE");
    expect(err.message).toBe("bad things");
    expect(err.statusCode).toBe(418);
    expect(err.details).toEqual({ extra: 1 });
    expect(err.name).toBe("DomainError");
  });

  test("NotFoundError → 404 NOT_FOUND", () => {
    const err = new NotFoundError("User not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  test("ConflictError → 409 CONFLICT", () => {
    const err = new ConflictError("duplicate email");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  test("UnauthorizedError → 401 UNAUTHORIZED", () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.message).toBe("Unauthorized");
  });

  test("ForbiddenError → 403 FORBIDDEN", () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  test("ValidationError → 400 VALIDATION_ERROR with details", () => {
    const issues = [{ field: "email", message: "invalid" }];
    const err = new ValidationError("Request failed", issues);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual(issues);
  });

  test("subclasses preserve instanceof chain", () => {
    const err = new NotFoundError("x");
    expect(err instanceof NotFoundError).toBe(true);
    expect(err instanceof DomainError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
