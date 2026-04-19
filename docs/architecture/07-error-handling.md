# Error Handling Conventions

All modules follow the same error handling patterns. Domain errors are thrown from service functions. A global error handler in the OpenAPIHono app formats them into consistent HTTP responses. The hierarchy lives in `@s/shared/errors`.

## DomainError Hierarchy

Lives in `packages/shared/src/errors/`:

```typescript
// packages/shared/src/errors/domain-error.ts
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
```

## Module-Specific Errors

Each module extends these for domain-specific errors. Lives in `packages/s-{module}/core/src/errors.ts`:

```typescript
// packages/s-authn/core/src/errors.ts
import { UnauthorizedError, ForbiddenError, ConflictError } from "@s/shared/errors";

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super("Invalid email or password");
    (this as { code: string }).code = "INVALID_CREDENTIALS";
  }
}

export class PasswordExpiredError extends UnauthorizedError {
  constructor() {
    super("Password has expired");
    (this as { code: string }).code = "PASSWORD_EXPIRED";
  }
}

export class UserDisabledError extends ForbiddenError {
  constructor() {
    super("Account is disabled");
    (this as { code: string }).code = "USER_DISABLED";
  }
}

export class EmailAlreadyExistsError extends ConflictError {
  constructor(email: string) {
    super(`User with email ${email} already exists`);
    (this as { code: string }).code = "EMAIL_ALREADY_EXISTS";
  }
}
```

## Error Response Format

Consistent structure for all error responses:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": null
  }
}
```

For validation errors, `details` contains the Zod issues:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "code": "invalid_type",
        "expected": "string",
        "received": "undefined",
        "path": ["email"],
        "message": "Required"
      }
    ]
  }
}
```

## HTTP Status Code Mapping

| Status | Error Class | When |
|---|---|---|
| **400** | `ValidationError` / ZodError | Malformed request body, invalid query params, missing required fields |
| **401** | `UnauthorizedError` | Missing token, expired token, invalid token, wrong credentials |
| **403** | `ForbiddenError` | Valid token but insufficient permissions, disabled account |
| **404** | `NotFoundError` | Resource does not exist |
| **409** | `ConflictError` | Duplicate resource (email exists, group name exists) |
| **429** | `RateLimitError` | Rate limit exceeded |
| **500** | (Unhandled) | Unexpected errors, programming bugs, infrastructure failures |
| **503** | `ServiceUnavailableError` | Graceful degradation (downstream down) |

## Global Error Handler

Every module registers the global handler in `api.ts`:

```typescript
// packages/s-{module}/functions/src/api.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { ZodError } from "zod";
import { DomainError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import type { AppEnv } from "./types.js";

const app = new OpenAPIHono<AppEnv>();

app.onError((err, c) => {
  const traceId = c.get("traceId");
  const userId = c.get("user")?.userId;

  // Known domain errors — return structured response
  if (err instanceof DomainError) {
    if (err.statusCode >= 500) {
      logger.error(`❌ ${err.message}`, {
        errorCode: err.code,
        statusCode: err.statusCode,
        stack: err.stack,
        traceId,
        userId,
      });
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
      },
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    );
  }

  // Zod validation errors — 400 with issue details
  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues,
        },
      },
      400,
    );
  }

  // Unknown errors — log full details, return sanitized message
  logger.error("❌ Unhandled error", {
    errorCode: "INTERNAL_ERROR",
    message: (err as Error).message,
    stack: (err as Error).stack,
    traceId,
    userId,
    method: c.req.method,
    path: c.req.path,
  });

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: null,
      },
    },
    500,
  );
});

export default app;
```

## Patterns

### Throw domain errors from services, not routes

```typescript
// GOOD: service throws, route stays clean
// packages/s-authn/core/src/auth/auth.service.ts
export async function login(email: string, password: string): Promise<TokenPair> {
  const user = await findUserByEmail(email);
  if (!user) throw new InvalidCredentialsError();
  if (!user.enabled) throw new UserDisabledError();
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new InvalidCredentialsError();
  }
  return issueTokens(user);
}

// Route handler is clean
auth.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid("json");
  const tokens = await login(email, password);
  return c.json({ data: tokens }, 200);
});
```

### Do NOT catch domain errors in route handlers

```typescript
// BAD — routes should let errors bubble to the global handler
auth.openapi(loginRoute, async (c) => {
  try {
    const tokens = await login(email, password);
    return c.json({ data: tokens }, 200);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return c.json({ error: "bad creds" }, 401);  // DON'T
    }
    throw err;
  }
});
```

Only catch domain errors inside services when you're **recovering** from them:

```typescript
// OK — service catches expected conflict to make operation idempotent
export async function createProfileIfMissing(userId: string, email: string): Promise<void> {
  try {
    await insertProfile({ id: userId, email });
  } catch (err) {
    if (err instanceof ConflictError) {
      logger.info("Profile already exists (idempotent)", { userId });
      return;
    }
    throw err;
  }
}
```

### Never expose stack traces to clients

The global handler logs the full stack but returns a generic message:

```json
// Client sees
{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }
```

```json
// Logs contain
{
  "severity": "ERROR",
  "errorCode": "INTERNAL_ERROR",
  "message": "Cannot read properties of undefined (reading 'email')",
  "stack": "TypeError: Cannot read properties of undefined...",
  "traceId": "abc123..."
}
```

### Use error codes for searchability

Every error has a unique, searchable `code` string:

```
CloudWatch Logs Insights:
| filter errorCode = "INVALID_CREDENTIALS"
| filter errorCode = "EMAIL_ALREADY_EXISTS"
| filter errorCode = "INTERNAL_ERROR"
```

### Handle expected failures gracefully

Some "errors" are normal (duplicate event retry, race condition on create). Log them at INFO, not ERROR:

```typescript
try {
  await insertProfile(profile);
} catch (err) {
  if (err instanceof ConflictError) {
    logger.info("Profile already exists (idempotent)", { userId: profile.id });
    return;
  }
  throw err;
}
```

### Preserve error cause

When rethrowing, preserve the original error via the `cause` field:

```typescript
try {
  await callKms();
} catch (err) {
  throw new DomainError(
    "KMS_SIGN_FAILED",
    "Could not sign JWT",
    500,
    { cause: err instanceof Error ? err.message : String(err) },
  );
}
```

The global handler serializes `details` into the response, so `cause` info ends up in logs (not client response).

## Lambda Handler Error Handling

For non-HTTP Lambdas (stream handler, event handler), the pattern is different — there's no global `app.onError`:

```typescript
// packages/s-{module}/functions/src/event-handler.ts
export async function handler(event: EventBridgeEvent<string, never>): Promise<void> {
  try {
    await processEvent(event);
  } catch (err) {
    logger.error("❌ Event handler failed", {
      errorCode: err instanceof DomainError ? err.code : "EVENT_HANDLER_FAILED",
      message: (err as Error).message,
      stack: (err as Error).stack,
      eventName: event["detail-type"],
    });
    // Rethrow to let Lambda retry (leading eventually to DLQ)
    throw err;
  }
}
```

## Validation Errors (Route Level)

Zod validation happens automatically via OpenAPIHono. Failed validation throws `ZodError`, caught by the global handler:

```typescript
const CreateUserRoute = createRoute({
  method: "post",
  path: "/users",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(8),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { /* ... */ } },
  },
});

admin.openapi(CreateUserRoute, async (c) => {
  const { email, password } = c.req.valid("json");  // typed, already validated
  // ...
});
```

If `email` is missing or invalid, Zod throws automatically → global handler returns 400 with issue details.

## Error Catalog

Every module maintains a list of error codes it can emit. Document in `packages/s-{module}/docs/ERRORS.md`:

```markdown
# s-authn error codes

| Code | Status | Meaning |
|---|---|---|
| INVALID_CREDENTIALS | 401 | Email or password incorrect |
| USER_DISABLED | 403 | Account disabled by admin |
| EMAIL_ALREADY_EXISTS | 409 | Registration with duplicate email |
| PASSWORD_EXPIRED | 401 | Password requires reset |
| MAGIC_LINK_EXPIRED | 401 | Magic link used after expiration |
| REFRESH_TOKEN_INVALID | 401 | Refresh token not found or rotated |
```

The module's `/info` endpoint may also expose this catalog under `errorCodes` for runtime discoverability.

## Never `any`, Never `as`

Per our TypeScript rules:

- Catch blocks: the `err` is unknown. Check its type with `instanceof` before accessing properties.
- When extracting `err.message`, use `(err as Error).message` only after checking `err instanceof Error`.
- Prefer narrowing to casting:

```typescript
// BAD
} catch (err: any) {
  logger.error("Failed", { message: err.message });
}

// GOOD
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Failed", { errorCode: "OPERATION_FAILED", message });
}
```

Biome enforces this in CI.

## Forbidden Patterns

- ❌ Catching `DomainError` in routes to return custom JSON — let the global handler do it
- ❌ Returning `{ error: "..." }` directly from a route — use `throw new SomeError()` instead
- ❌ Re-throwing without preserving cause — use `{ cause: err }` or wrap in a new DomainError with `details`
- ❌ `catch (err: any)` or `catch (err: Error)` — unknown catches, narrow explicitly
- ❌ Exposing stack traces or internal messages to clients
- ❌ Logging validation errors at ERROR — they're client errors, log at DEBUG if at all
