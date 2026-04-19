# Authentication & Authorization

Full auth architecture: how tokens are issued, how they are verified, how permissions are checked, and how modules authenticate to each other.

## JWT Strategy: RS256 + AWS KMS

All JWTs in s-platform are signed with RS256 (RSA + SHA-256) using an RSA-4096 key in AWS KMS.

**Why RS256 over HMAC (HS256):**

With 20+ modules needing to verify tokens, a symmetric key (HMAC) would require distributing the same secret everywhere. This creates:

- Large blast radius if any single module is compromised
- Operational burden to rotate across all modules simultaneously
- Violation of least-privilege (every module could forge tokens)

With RS256, only s-authn holds the private key (in AWS KMS). All other modules verify via the JWKS endpoint. The private key never leaves KMS's HSM.

## KMS Key Configuration

**Alias:** `alias/s-authn-jwt-{stage}` (e.g., `alias/s-authn-jwt-dev`, `alias/s-authn-jwt-prod`)

**Key spec:** `RSA_4096`

**Key usage:** `SIGN_VERIFY`

**Signing algorithm:** `RSASSA_PKCS1_V1_5_SHA_256` (RS256 in JWT terms)

**Multi-region:** No (keep simple; KMS Multi-Region Keys available if needed later).

Provisioned in `infra/shared.ts` by SST:

```typescript
// infra/shared.ts
export const jwtSigningKey = new aws.kms.Key("JwtSigningKey", {
  description: `s-authn JWT signing key (${$app.stage})`,
  keyUsage: "SIGN_VERIFY",
  customerMasterKeySpec: "RSA_4096",
  deletionWindowInDays: 30,
});

new aws.kms.Alias("JwtSigningKeyAlias", {
  name: `alias/s-authn-jwt-${$app.stage}`,
  targetKeyId: jwtSigningKey.id,
});
```

## Access Token

**Format:** JWT (RS256)

**Payload:**

```json
{
  "sub": "01HXYZ...",      // user ID (ULID)
  "iss": "s-authn",
  "aud": "s-platform",
  "iat": 1700000000,
  "exp": 1700003600        // 1 hour from iat
}
```

**TTL:** 1 hour.

**Design decisions:**

- **No permissions in the token.** Permissions load from `authz_view` at verification time. Permission changes take effect within the cache TTL (5 min prod, 1 min dev) without requiring a new token.
- **Minimal payload.** Only identity claims. No email, no name, no roles.
- **KID in header.** Allows key rotation without invalidating existing tokens.

## Refresh Token

**Format:** JWT (RS256)

**Payload:**

```json
{
  "sub": "01HXYZ...",
  "jti": "01HABC...",      // unique per refresh token
  "iss": "s-authn",
  "aud": "s-platform",
  "iat": 1700000000,
  "exp": 1700086400        // 24 hours from iat
}
```

**TTL:** 24 hours.

**Storage:** The refresh token's `jti` is hashed with argon2id and stored in `AuthnRefreshTokens` DynamoDB table. On refresh, the presented token's `jti` is hashed and compared against the stored hash.

**Rotation:** Each refresh issues a new access token + new refresh token. Previous refresh token is invalidated. Limits the window of compromise if a refresh token leaks.

## JWKS Endpoint

**Endpoint:** `GET /authn/auth/jwks` (served by s-authn, public)

**Response:**

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "alias/s-authn-jwt-dev-v1",
      "alg": "RS256",
      "use": "sig",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

The `n` (modulus) and `e` (exponent) come from KMS's `GetPublicKey` API (cached in s-authn for 1 hour).

### Consuming Services

Modules use `jose` to verify tokens:

```typescript
// packages/shared/src/auth/verify.ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URL = new URL(`${process.env.AUTHN_URL}/authn/auth/jwks`);
const jwks = createRemoteJWKSet(JWKS_URL);  // 1-hour cache built-in

export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "s-authn",
    audience: "s-platform",
  });
  return payload;
}
```

## Lambda Authorizer (Custom, Shared)

A single Lambda authorizer is shared across all protected routes. Lives in `@s/shared/auth/authorizer.ts`, deployed as a dedicated Lambda per stage.

### Flow

```
1. Request hits API Gateway with Authorization: Bearer <jwt>
         ↓
2. API Gateway invokes authorizer Lambda with the token
         ↓
3. Authorizer Lambda:
     a. Extract Bearer token
     b. SHA-256 hash → check in-memory cache
         ├ HIT  → return cached policy (allow + userContext)
         └ MISS → jwtVerify(token, jwks)
                → load AuthzView[userId] from DynamoDB
                → build UserContext { userId, permissions }
                → cache (key: token hash, TTL: 5min prod / 1min dev)
                → return policy
         ↓
4. API Gateway injects UserContext into request context
         ↓
5. Hono middleware reads c.get("user") for handler access
```

### Cache TTL

- **Production:** 5 minutes — balances freshness with performance
- **Development:** 1 minute — faster feedback when testing permission changes
- Controlled via env var `AUTHZ_CACHE_TTL_MS`

### Why hash the token for the cache key

Full JWT is ~800 bytes. SHA-256 hash is 32 bytes. Hashing saves memory and avoids keeping full token strings in Lambda memory.

### Lambda Authorizer vs In-Handler Auth Middleware

Two options for where to do auth:

1. **Lambda authorizer** (chosen for protected routes) — API Gateway invokes authorizer before the main Lambda. Benefits: separate Lambda keeps API Lambda focused on business logic; authorizer cache is shared; 401/403 responses don't cost API Lambda invocations.

2. **In-handler middleware** — Hono middleware inside the main Lambda. Used for `/info` endpoint (so Lambda has full Hono context).

Decision rule: use Lambda authorizer for all protected module routes (`/authn/*`, `/user/*`, etc.). Use in-handler middleware for `/info` and any edge cases.

## Permission Model

Permissions stored as a flat list per user in `AuthzView`:

```typescript
type Permission = {
  id: string;           // e.g., "user_admin", "manage_locations"
  value?: unknown[];    // optional scoping values
};

// AuthzView document
type AuthzView = {
  userId: string;       // partition key
  permissions: Permission[];
  updatedAt: string;
};
```

**Simple permissions:** `{ id: "user_admin" }` — boolean has/doesn't have.

**Value-scoped permissions:** `{ id: "manage_locations", value: ["nyc", "sf"] }` — user has the permission for listed values only.

## Permission Middleware

Three middleware functions in `@s/shared/auth`:

### `requirePermission(permissionId: string)`

```typescript
import { requirePermission } from "@s/shared/auth";

app.openapi(
  createRoute({
    method: "get",
    path: "/admin/users",
    middleware: [requirePermission("user_admin")],
    // ...
  }),
  listUsersHandler,
);
```

Returns 403 if user doesn't have the permission.

### `requireSelfOrPermission(permissionId: string)`

User can access their own resource (`:userId` matches `c.get("user").userId`) OR has the admin permission:

```typescript
app.openapi(
  createRoute({
    method: "patch",
    path: "/user/:userId",
    middleware: [requireSelfOrPermission("user_admin")],
    // ...
  }),
  updateUserHandler,
);
```

### `requirePermissionWithValue(permissionId: string, extractor: (c) => string)`

Permission must include a specific value:

```typescript
app.openapi(
  createRoute({
    method: "post",
    path: "/admin/locations/:locationId/settings",
    middleware: [
      requirePermissionWithValue("manage_locations", (c) => c.req.param("locationId")),
    ],
    // ...
  }),
  updateLocationHandler,
);
```

## Inter-Service Authentication

Two modes for inter-service auth:

### 1. User-context passthrough (preferred)

When Module A calls Module B on behalf of the user, forward the user's Bearer token. Module B verifies the same JWT + loads the same authz-view. No new token issued.

```typescript
// Module A calling Module B
await fetch(`${USER_API_URL}/user/${userId}`, {
  headers: { Authorization: `Bearer ${c.req.header("authorization")!.slice(7)}` },
});
```

### 2. System token (for non-user-triggered calls)

When s-authz rebuilds authz_view from a user.registered event, there's no user token. Use a system JWT:

**Endpoint:** `POST /authn/auth/token/service` (internal, requires IAM auth)

**Flow:**

1. Calling module assumes an IAM role (SST `link` grants this automatically).
2. Signs a request to s-authn's service token endpoint using SigV4.
3. s-authn verifies the IAM caller, issues a platform JWT with `system: true`.
4. Calling module uses this JWT for subsequent internal calls.

**System token payload:**

```json
{
  "sub": "s-authz",
  "iss": "s-authn",
  "aud": "s-platform",
  "system": true,
  "iat": 1700000000,
  "exp": 1700003600
}
```

The `system: true` claim grants elevated access. Modules check `c.get("user").system === true` for system-level operations.

### System Permission Middleware

```typescript
import { requireSystem } from "@s/shared/auth";

app.openapi(
  createRoute({
    method: "post",
    path: "/admin/authz-view/rebuild",
    middleware: [requireSystem()],
    // ...
  }),
  rebuildAuthzViewHandler,
);
```

## Bootstrap Phase

When the platform is being deployed for the first time, s-authz may not be running. During bootstrap:

1. s-authn issues a JWT with `system: true` for an initial admin user.
2. `requireSystem()` middleware allows the call regardless of permissions.
3. Admin uses this token to configure roles/permissions in s-authz.
4. Once authz_view is populated, normal permission checks take over.

Bootstrap flow documented per-module in `packages/s-{module}/docs/BOOTSTRAP.md`.

## JWT Cache Strategy (in Lambda)

Lambdas cache verified tokens in memory. Cache survives across invocations in the same Lambda container (warm starts).

```typescript
// packages/shared/src/auth/cache.ts
const cache = new Map<string, { context: UserContext; expires: number }>();

export function getCached(tokenHash: string): UserContext | null {
  const entry = cache.get(tokenHash);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.context;
}

export function setCached(tokenHash: string, context: UserContext): void {
  cache.set(tokenHash, {
    context,
    expires: Date.now() + CACHE_TTL_MS,
  });
}
```

**Important:** This cache is per-Lambda-container. Cold starts lose cache. That's fine — JWT verification is fast enough.

## Revocation

### Access tokens
Not revoked. Short TTL (1h) limits exposure. On compromise, rotate KMS key → next JWKS fetch fails all old tokens.

### Refresh tokens
Invalidate via `AuthnRefreshTokens` table. Delete the row by `jti`. Authz_view cache may still contain permissions for the user until TTL expires — for urgent revocation, use the admin `/authn/admin/users/:id/revoke` endpoint which sets a `disabled` flag that middleware checks alongside authz_view.

## Key Rotation

KMS supports automatic yearly rotation for symmetric keys, but RSA keys don't auto-rotate. Manual rotation:

1. Create new KMS key version (`alias/s-authn-jwt-{stage}-v2`).
2. Add the new public key to JWKS response with new KID.
3. Wait for current access tokens to expire (1 hour) + refresh tokens to expire (24 hours).
4. Update signing to use v2 KID.
5. Old key can be removed from JWKS after 25 hours.

Automation TBD — one-off script until the platform has real rotation cadence.
