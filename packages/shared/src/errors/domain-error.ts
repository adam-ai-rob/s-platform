/**
 * Base class for all domain errors in the platform.
 *
 * Services throw DomainError subtypes. The global error handler in
 * `createApi` maps them to structured HTTP responses via statusCode.
 *
 * Never expose stack traces or internal messages to clients — the
 * handler logs full details and returns only `{ code, message, details }`.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public override readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("NOT_FOUND", message, 404, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, 409, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class RateLimitError extends DomainError {
  constructor(message = "Too many requests", details?: unknown) {
    super("RATE_LIMIT_EXCEEDED", message, 429, details);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = "Service temporarily unavailable") {
    super("SERVICE_UNAVAILABLE", message, 503);
  }
}
