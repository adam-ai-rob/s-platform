# API Conventions

All modules follow the same API design patterns. This document is mandatory reading for any agent building a new module or an endpoint.

## Framework: OpenAPIHono

All HTTP handling uses `@hono/zod-openapi` (OpenAPIHono). It provides Hono routing with automatic OpenAPI 3.1 spec generation from Zod schemas.

```typescript
// packages/s-{module}/functions/src/api.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./types.js";

const app = new OpenAPIHono<AppEnv>();
```

## Mandatory Endpoints

**Every deployed module MUST expose these four endpoints.** Non-negotiable. The AI agent for the module is responsible for maintaining them.

### `GET /health` — Public

Uptime check. No authentication. No downstream dependencies. Returns in < 10ms.

```typescript
app.get("/health", (c) => c.json({ status: "ok" }));
```

Used by:

- CloudWatch Synthetics canaries (every minute)
- API Gateway health probes
- Load-balancer-free routing (returns 200 as long as Lambda is running)

**Never log successful health checks.** Thousands per day per module would drown signal.

### `GET /info` — Authenticated

Service metadata for runtime discovery. Returns what the module does, what permissions it consumes, what events it publishes/subscribes, and what topics it uses.

```typescript
app.get("/info", authMiddleware(), (c) => {
  return c.json({
    data: {
      service: "s-authn",
      stage: process.env.STAGE ?? "dev",
      version: process.env.VERSION ?? "unknown",
      permissions: {
        authn_admin: "Full CRUD on authentication users, view audit logs",
        authn_read: "Read-only access to authentication user data",
      },
      events: {
        publishes: [
          "user.registered",
          "user.email.verified",
          "user.disabled",
          "user.enabled",
          "user.password.changed",
          "user.magic-link.requested",
          "user.password.reset-requested",
          "user.email.verify-requested",
        ],
        subscribes: [],
      },
      topics: {
        "user-events": "User lifecycle events (registration, enable/disable, verification)",
      },
      errorCodes: {
        INVALID_CREDENTIALS: "Email or password incorrect",
        USER_DISABLED: "Account disabled by admin",
        EMAIL_ALREADY_EXISTS: "Registration with duplicate email",
      },
    },
  });
});
```

Purpose:

- Admin dashboards render this to explain what each module does
- AI agents discover the current contract without reading source
- Integration tests assert the contract hasn't silently drifted
- Reviewers verify `events.publishes` matches what the code actually publishes

**Agents must keep this up to date.** Any change to permissions, events, or topics requires a matching `/info` update in the same PR.

### `GET /openapi.json` — Public

Auto-generated OpenAPI 3.1 spec from route definitions. No manual maintenance.

```typescript
// packages/s-{module}/functions/src/api.ts
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "s-authn — Authentication Service",
    version: "1.0.0",
    description: "Identity, credentials, JWT issuance, JWKS endpoint.",
  },
  servers: [
    { url: "https://s-api.smartiqi.com", description: "Prod" },
    { url: "https://test.s-api.smartiqi.com", description: "Test" },
    { url: "https://dev.s-api.smartiqi.com", description: "Dev" },
    { url: "http://localhost:3000", description: "Local" },
  ],
  security: [{ Bearer: [] }],
});

app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
```

### `GET /docs` — Public

Swagger UI pointing at `/openapi.json`:

```typescript
import { swaggerUI } from "@hono/swagger-ui";

app.get("/docs", swaggerUI({ url: "/openapi.json" }));
```

The typed HTTP clients in `s-tests` consume `/openapi.json` for contract testing.

## Mandatory Endpoint Registration (Factory)

To eliminate boilerplate and enforce consistency, `@s/shared/http` exports a factory:

```typescript
// packages/shared/src/http/create-api.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { traceMiddleware } from "../trace/middleware.js";
import { authMiddleware } from "../auth/middleware.js";
import { globalErrorHandler } from "../errors/handler.js";

export interface ApiMetadata {
  service: string;
  title: string;
  description: string;
  version: string;
  permissions: Record<string, string>;
  events: { publishes: string[]; subscribes: string[] };
  topics: Record<string, string>;
  errorCodes?: Record<string, string>;
}

export function createApi<TEnv extends object>(metadata: ApiMetadata) {
  const app = new OpenAPIHono<TEnv>();

  app.use("*", traceMiddleware());

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/info", authMiddleware(), (c) =>
    c.json({
      data: {
        service: metadata.service,
        stage: process.env.STAGE ?? "dev",
        version: process.env.VERSION ?? metadata.version,
        permissions: metadata.permissions,
        events: metadata.events,
        topics: metadata.topics,
        errorCodes: metadata.errorCodes ?? {},
      },
    }),
  );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: metadata.title,
      version: metadata.version,
      description: metadata.description,
    },
    servers: [
      { url: `https://s-api.smartiqi.com`, description: "Prod" },
      { url: `https://test.s-api.smartiqi.com`, description: "Test" },
      { url: `https://dev.s-api.smartiqi.com`, description: "Dev" },
    ],
    security: [{ Bearer: [] }],
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  app.onError(globalErrorHandler);

  return app;
}
```

Module usage:

```typescript
// packages/s-authn/functions/src/api.ts
import { createApi } from "@s/shared/http";
import type { AppEnv } from "./types.js";
import authRoutes from "./routes/auth.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = createApi<AppEnv>({
  service: "s-authn",
  title: "s-authn — Authentication Service",
  description: "Identity, credentials, JWT issuance, JWKS endpoint.",
  version: "1.0.0",
  permissions: {
    authn_admin: "Full CRUD on authentication users",
    authn_read: "Read-only access to auth user data",
  },
  events: {
    publishes: ["user.registered", "user.disabled", "user.enabled", /* ... */],
    subscribes: [],
  },
  topics: {
    "user-events": "User lifecycle events",
  },
});

app.route("/auth", authRoutes);
app.route("/admin", adminRoutes);

export default app;
```

## Lambda Handler Export

Wrap the app for AWS Lambda:

```typescript
// packages/s-{module}/functions/src/handler.ts
import { handle } from "@hono/aws-lambda";
import app from "./api.js";

export const handler = handle(app);
```

## Route Grouping

Organize routes by access level:

| Prefix | Access | Purpose |
|---|---|---|
| `/health`, `/info`, `/openapi.json`, `/docs` | Mixed (see above) | Infrastructure endpoints |
| `/auth/*` | Public | Authentication flows (login, register, refresh) — s-authn only |
| `/user/*` | Authenticated (self) | Self-service (own profile, own groups) |
| `/admin/*` | Permission-gated | Administrative operations |
| `/_events` | System (IAM-gated) | Not API Gateway — separate Lambda for EventBridge/SQS |

### Route prefix by module

The shared API Gateway routes by path prefix:

- `/authn/*` → s-authn Lambda
- `/authz/*` → s-authz Lambda
- `/user/*` → s-user Lambda
- `/group/*` → s-group Lambda
- `/{module}/*` → module Lambda

Inside each module's Lambda, the Hono app mounts sub-routers:

```typescript
// Inside s-authn Lambda, paths relative to /authn
app.route("/auth", authRoutes);       // final path: /authn/auth/*
app.route("/admin", adminRoutes);     // final path: /authn/admin/*
```

## Route Definition Pattern (OpenAPIHono)

Use `createRoute` for typed route definitions:

```typescript
// packages/s-authn/functions/src/routes/auth.routes.ts
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { login } from "@s-authn/core/auth/auth.service.js";
import type { AppEnv } from "../types.js";

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const LoginResponse = z.object({
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number(),
  }),
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["auth"],
  request: {
    body: {
      content: { "application/json": { schema: LoginBody } },
    },
  },
  responses: {
    200: {
      description: "Tokens issued",
      content: { "application/json": { schema: LoginResponse } },
    },
    401: { description: "Invalid credentials" },
    429: { description: "Rate limited" },
  },
});

const auth = new OpenAPIHono<AppEnv>();

auth.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid("json");
  const tokens = await login(email, password);
  return c.json({ data: tokens }, 200);
});

export default auth;
```

The route is now in the OpenAPI spec with full schema, and `c.req.valid("json")` returns a typed `{ email: string; password: string }`.

## Request Validation

Validation is automatic via Zod schemas in `createRoute`. No `zValidator` middleware needed.

### Body validation

```typescript
const CreateUserRoute = createRoute({
  method: "post",
  path: "/users",
  request: {
    body: {
      content: { "application/json": { schema: CreateUserSchema } },
    },
  },
  // ...
});
```

### Query parameters

```typescript
const ListUsersQuery = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  nextToken: z.string().optional(),
  query: z.string().optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

const ListUsersRoute = createRoute({
  method: "get",
  path: "/users",
  request: {
    query: ListUsersQuery,
  },
  // ...
});
```

### Path parameters

```typescript
const GetUserRoute = createRoute({
  method: "get",
  path: "/users/{id}",
  request: {
    params: z.object({ id: z.string() }),
  },
  // ...
});
```

**Note:** OpenAPIHono uses `{id}` syntax in `path`, not `:id` (OpenAPI convention).

### Headers

```typescript
request: {
  headers: z.object({
    "x-location": z.string().optional(),
  }),
},
```

## Response Format

### Single resource (200 or 201)

```json
{
  "data": {
    "id": "01HXYZ...",
    "email": "user@example.com",
    "firstName": "Alice",
    "lastName": "Smith",
    "createdAt": "2026-04-17T10:30:00.000Z"
  }
}
```

201 for creation, 200 for retrieval or update.

### List of resources (200)

```json
{
  "data": [
    { "id": "01HABC...", "email": "alice@example.com" },
    { "id": "01HDEF...", "email": "bob@example.com" }
  ],
  "metadata": {
    "nextToken": "eyJpZCI6IjAxSERFRiJ9"
  }
}
```

When `metadata.nextToken` is absent or null, there are no more pages.

### No content (204)

Empty response body. Use for deletes and some updates.

### Accepted (202)

Empty response body. Use for async operations (e.g., triggering an authz-view rebuild).

### Error (4xx / 5xx)

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "details": null
  }
}
```

See [07-error-handling.md](07-error-handling.md).

## Pagination

All list endpoints use cursor pagination:

**Request:**
```
GET /admin/users?limit=20&nextToken=eyJpZCI...
```

**Query params:**

| Param | Type | Default | Max | Description |
|---|---|---|---|---|
| `limit` | number | 20 | 100 | Page size |
| `nextToken` | string | — | — | Opaque cursor from previous response |

**Response:**

```json
{
  "data": [...],
  "metadata": {
    "nextToken": "eyJpZCI6..."
  }
}
```

- First page: omit `nextToken`
- Last page: `metadata.nextToken` is absent or null
- Clients should treat `nextToken` as opaque — don't parse or modify

## Search

Prefix/text search uses `query`:

```
GET /admin/users?query=alice@
```

Backed by DynamoDB GSI `begins_with` or Algolia (if the module needs it). Results limited to 20 by default.

## Filtering

Explicit query params:

```
GET /admin/users?enabled=true
GET /admin/groups?type=company
GET /admin/groups?status=active
```

Combinable with search and pagination:

```
GET /admin/users?query=alice&enabled=true&limit=10
```

## Rate Limiting

Rate limiting on auth mutation endpoints (login, register, refresh, password reset).

**Implementation:** DynamoDB-backed sliding-window counters in a shared `RateLimits` table (in `@s/shared`). Lambda checks the counter, increments, and compares against the limit.

**Response on limit exceeded:**

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000060

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "details": null
  }
}
```

**Default limits (per IP):**

| Endpoint | Window | Max |
|---|---|---|
| `POST /authn/auth/login` | 1 min | 10 |
| `POST /authn/auth/register` | 1 min | 5 |
| `POST /authn/auth/token/refresh` | 1 min | 20 |
| `POST /authn/auth/password/reset` | 1 min | 3 |

IP from the `x-forwarded-for` header (API Gateway sets this). Rate limiter available as middleware from `@s/shared`.

## CORS

API Gateway CORS is configured at the gateway level with wildcard origin:

```typescript
// infra/shared.ts
export const gateway = new sst.aws.ApiGatewayV2("PlatformGateway", {
  cors: {
    allowOrigins: ["*"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Traceparent"],
    allowCredentials: false,
  },
});
```

**Why wildcard:**

- Auth is JWT bearer tokens in `Authorization` header — not cookies
- `credentials: false` is required for wildcard `allowOrigins: ["*"]`
- No security risk — bearer token must be present for protected routes

**Do not change CORS without consulting the team.** Clients in multiple domains depend on the wildcard.

## Request Size Limits

- Request body: max 10 MB (API Gateway hard limit is 10 MB)
- Response body: max 10 MB
- For larger payloads: use S3 presigned URLs (not implemented yet; add per-module when needed)

## HTTP Method Conventions

Follow REST:

- **GET** — retrieve resource (200)
- **POST** — create resource (201)
- **PATCH** — partial update (200 or 204) — **preferred for updates**
- **PUT** — full replace (200 or 204) — only when complete replacement is required
- **DELETE** — remove resource (204)

**PATCH preference rationale:**

- More flexible than PUT (don't need full payload)
- Supports field removal via `null`, `""`, `[]` in body → BaseRepository converts to DynamoDB REMOVE
- Smaller payloads, fewer accidental overwrites

## Path Parameters: `{}` Syntax

Per OpenAPI convention, use `{id}` not `:id`:

```typescript
path: "/users/{id}",     // ✅
path: "/users/:id",      // ❌
```

**Path ID is source of truth:** If body contains `id` and path contains `{id}`, the path wins. Validate/override body ID in the service layer.

## Postman Collection

Each module maintains a Postman collection at `packages/s-{module}/docs/postman/{Module}.postman_collection.json`. Updated in the same PR as any endpoint change. Reviewers verify Postman is up to date.

The collection is generated from `/openapi.json` via `openapi-to-postman` (scripted in `packages/s-{module}/scripts/update-postman.sh`).

## Response Schema Changes (Breaking Changes)

**Changes to response Zod schemas require explicit user/product-owner approval before merge.** This includes:

- Removing or renaming response fields
- Changing field types
- Changing the response envelope structure
- Making required fields optional (or vice versa)

Adding new optional fields is generally safe but should be noted in the PR description.

Reviewers MUST flag response schema changes and block merge until approval.

## Release Notes

Every PR updates `RELEASE_NOTES.md` under `## Unreleased`:

```markdown
## Unreleased

### Changes
- **Feature**: Add magic-link authentication flow to s-authn (PR #12)
- **Fix**: Correct CORS headers for OPTIONS preflight on /admin routes (PR #13)
- **Breaking**: Remove deprecated `/auth/old-login` endpoint (PR #14)
```

On release cut (merge to `stage/prod`): rename to `## v2026.MM.N — YYYY-MM-DD`, add fresh `## Unreleased`, tag.
