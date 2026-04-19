# s-authn

Authentication service for the s-platform. Owns platform user identity, credentials, JWT issuance, and JWKS publication.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules and [platform architecture docs](../../docs/architecture/README.md).

## Scope (this module)

**Implemented (Phase 1):**
- Register / login with email+password (argon2id)
- Access + refresh token issuance via AWS KMS (RS256)
- Refresh token rotation + revocation
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
