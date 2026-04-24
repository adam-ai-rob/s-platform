# s-authn — AI Agent Rules

Authentication service: identity, credentials, JWT issuance, JWKS, refresh tokens, magic links, password reset, email verification.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

**REST conventions:** see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). All s-authn endpoints conform to v1 conventions. Custom actions (e.g. `sessions:revoke`) follow Google AIP-136 `:verb` form — the module rewrites `:verb` to an internal `/_actions/verb` segment because Hono's router can't parse `:` as a path suffix; see `functions/src/api.ts`.

## Bounded Context

**What s-authn owns:**
- Platform user identity (`AuthnUser` — id, email, password hash, flags)
- Credentials (password hash via argon2id)
- JWT issuance (access + refresh) and JWKS publication via AWS KMS
- Refresh token lifecycle (issue, verify, rotate, revoke)
- Magic-link / OTP / password-reset / email-verify codes *(Phase 2 — not in this port)*
- Audit log of auth events *(Phase 2 — not in this port)*

**What s-authn does NOT own:**
- User profile data (names, avatar, preferences) → s-user
- Permissions and roles → s-authz
- Group membership → s-group

## DynamoDB Tables

| Table | PK | SK | GSIs | Notes |
|---|---|---|---|---|
| `AuthnUsers` | `id` (ULID) | — | `ByEmail` (email) | Primary user record |
| `AuthnRefreshTokens` | `id` (JTI, ULID) | — | `ByUserId` (userId + createdAt) | TTL on `expiresAt` |

Phase 2 tables (not yet provisioned):
- `AuthnCodes` — magic link / OTP / reset codes, TTL on `expiresAt`
- `AuthnLogs` — audit log

## Events

### Publishes

Via DDB Streams → `stream-handler` → EventBridge `platform-events` bus.

| Event | Payload | When |
|---|---|---|
| `user.registered` | `{ userId, email }` | INSERT on AuthnUsers |
| `user.enabled` | `{ userId }` | `enabled: false → true` transition |
| `user.disabled` | `{ userId }` | `enabled: true → false` transition |
| `user.password.changed` | `{ userId }` | password hash changed |

Phase 2 events (once magic links and reset are ported):
- `user.magic-link.requested`
- `user.password.reset-requested`
- `user.email.verify-requested`
- `user.email.verified`

### Subscribes

None currently.

## Permissions

| Permission | Scope | Purpose |
|---|---|---|
| `authn_admin` | global | Full CRUD on AuthnUsers via `/authn/admin/*` |
| `authn_read` | global | Read-only access to auth user data |

## API Surface

### Public (no auth)

- `POST /authn/auth/register` — register a new user, returns tokens
- `POST /authn/auth/login` — login with email+password, returns tokens
- `POST /authn/auth/token/refresh` — exchange refresh token for new access token
- `GET /authn/auth/jwks` — public JWKS for other modules to verify tokens
- `GET /authn/health` — platform standard
- `GET /authn/openapi.json` — platform standard
- `GET /authn/docs` — platform standard

### Authenticated

- `GET /authn/info` — platform standard (service metadata)
- `POST /authn/user/sessions:revoke` — revoke the caller's refresh token (AIP-136 custom action; identify session via `X-Refresh-JTI` header)
- `PATCH /authn/user/users/me/password` — change password

### Phase 2 (not in this port)

- Magic link: `POST /authn/auth/send-magic-link`, `POST /authn/auth/token/code`
- Password reset: `POST /authn/auth/forgot-password`, `POST /authn/auth/reset-password`
- Email verification: `POST /authn/auth/send-verification`, `POST /authn/auth/verify-email`
- Admin: `GET/POST/PATCH/DELETE /authn/admin/users`
- Sessions: `GET /authn/user/me/sessions`, `DELETE /authn/user/me/sessions/{id}`
- Service-to-service: `POST /authn/auth/token/service` (needs AWS IAM SigV4 — design later)

## KMS Signing

- Key: `alias/s-authn-jwt-{stage}` (RSA-4096, `SIGN_VERIFY`, `RSASSA_PKCS1_V1_5_SHA_256`)
- Provisioned in `infra/shared.ts`
- Signer computes SHA-256 digest of the JWT signing input, calls KMS `Sign` with `MessageType: DIGEST`, base64url-encodes the returned signature
- JWKS endpoint fetches the public key via KMS `GetPublicKey`, converts SPKI → JWK using `jose`, caches for 1 hour

## Running Locally

```bash
# from monorepo root
bun sst dev --stage $USER
```

Your personal stage will have its own `alias/s-authn-jwt-{USER}` key — no sharing with dev.

## Tests

```bash
bun test packages/s-authn                    # unit
STAGE=$USER bun test packages/s-tests -t auth  # journey (once written)
```

## Change Rules

- Response schema changes require explicit approval (see platform CLAUDE.md)
- Any change to `AuthMetadata` in `api.ts` (permissions, events, topics) → update this file's tables in the same PR
- New KMS operations → update `infra/shared.ts` policies
- Never log passwords, plaintext tokens, or argon2 hashes
