# s-authn

Authentication service for the s-platform. Owns platform user identity, credentials, JWT issuance, and JWKS publication.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules, [platform architecture docs](../../docs/architecture/README.md), and the generated `/authn/openapi.json` contract for the complete HTTP schema.

## Scope (this module)

**Implemented (Phase 1):**
- Register / login with email+password (argon2id)
- Access + refresh token issuance via AWS KMS (RS256)
- Refresh token validation + revocation
- Logout
- Password change
- JWKS endpoint for other modules to verify tokens
- `user.registered`, `user.enabled`, `user.disabled`, `user.password.changed` events via DDB Streams

**Deferred (follow-up PRs):**
- Magic link / OTP flow
- Forgot password / reset
- Email verification
- Audit log
- Admin CRUD endpoints
- Service-to-service token exchange (AWS IAM SigV4 based)

## Structure

```
s-authn/
├── core/                    # Pure domain logic
│   └── src/
│       ├── users/           # AuthnUser entity + repository + service
│       ├── refresh-tokens/  # AuthnRefreshToken entity + repository
│       ├── tokens/          # KMS signing + JWKS
│       ├── auth/            # register, login, refresh, logout, change-password
│       └── shared/          # module-specific errors
├── functions/               # Lambda handlers
│   └── src/
│       ├── api.ts           # Hono app
│       ├── handler.ts       # Lambda export
│       ├── stream-handler.ts # DDB Streams → EventBridge publisher
│       ├── routes/          # auth.routes, user.routes
│       └── schemas/         # Zod schemas for requests
└── tests/                   # Unit tests
```

## Key Environment Variables

Injected by SST link in `infra/s-authn.ts`:

| Var | Source |
|---|---|
| `AuthnUsers` table name | from SST Dynamo link |
| `AuthnRefreshTokens` table name | from SST Dynamo link |
| `KMS_KEY_ALIAS` | `alias/s-authn-jwt-{stage}` |
| `EVENT_BUS_NAME` | from SST Bus link |
| `STAGE` | current stage |
| `JWT_ISSUER` | `s-authn` |
| `JWT_AUDIENCE` | `s-platform` |

## Endpoints

Auth audience (`/authn/auth/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `POST /authn/auth/register` | none | Creates a user identity from `email` and `password`, then returns `{ data: { accessToken, refreshToken, tokenType, expiresIn } }`. Returns `409` when the email is already registered. |
| `POST /authn/auth/login` | none | Authenticates with `email` and `password`, then returns the same token response as registration. Returns `401` for invalid credentials and `403` for disabled or expired-password accounts. |
| `POST /authn/auth/token/refresh` | none | Exchanges a valid refresh token for `{ data: { accessToken, tokenType, expiresIn } }`. Returns `401` when the refresh token is malformed, expired, revoked, or does not match the stored token hash. |
| `GET /authn/auth/jwks` | none | Returns the JWKS used to verify JWTs issued by s-authn. |

User audience (`/authn/user/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `POST /authn/user/sessions:revoke` | bearer token | Revokes the caller's refresh token identified by the `X-Refresh-JTI` header. Returns `204` when revoked and `400` when the header is missing. |
| `PATCH /authn/user/users/me/password` | bearer token | Changes the caller's password using `currentPassword` and `newPassword`. Returns `204` on success and `401` when the current password is wrong or the bearer token is invalid. |

Plus `/authn/health`, `/authn/info`, `/authn/openapi.json`, and `/authn/docs`.

## Postman

[`docs/postman/authn.postman_collection.json`](./docs/postman/authn.postman_collection.json) includes the authentication and caller-account endpoints with `{{baseUrl}}`, `{{accessToken}}`, `{{refreshToken}}`, and `{{refreshJti}}` variables. Use a stage base URL such as `https://dev.s-api.smartiqi.com`; after register or login, copy the returned tokens into the collection variables.

Common error paths:
- `400` — request validation failed, such as missing `X-Refresh-JTI` on `sessions:revoke`.
- `401` — invalid credentials, invalid bearer token, invalid refresh token, or wrong current password.
- `403` — account is disabled or requires a password reset.
- `409` — registration email already exists.
