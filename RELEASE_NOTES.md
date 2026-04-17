# Release Notes

Versioning: **CalVer** (`vYYYY.MM.N`). Releases cut on merge to `stage/prod`.

## Unreleased

### Changes
- **Chore**: Initial monorepo scaffold — SST v3, Bun, Biome, Turborepo
- **Chore**: Shared API Gateway, EventBridge bus, KMS signing key (infra)
- **Chore**: `@s/shared` skeleton (errors, logger, trace, HTTP factory)
- **Chore**: GitHub Actions workflows — CI, deploy, per-PR stages
- **Chore**: CODEOWNERS setup for maintainer review
- **Feature**: `@s/shared/ddb` — `BaseRepository`, client singleton, pagination helpers, PATCH semantics (null/""/[] → REMOVE)
- **Feature**: `@s/shared/events` — `PlatformEvent` envelope, `publishEvent()` for EventBridge, idempotency helper scaffold
- **Feature**: `@s/shared/auth` — JWT verify with remote JWKS, in-memory token cache, `authMiddleware` + `requirePermission` / `requireSelfOrPermission` / `requireSystem`
- **Feature**: `/info` endpoint now protected by `authMiddleware`
- **Feature**: `packages/s-tests` workspace package — stage URL resolver, typed fetch client, `eventually()` helper, smoke test placeholder
- **Feature**: `s-authn` module ported from GCP/Astra to AWS/DynamoDB/SST (Phase 1 — register, login, refresh, logout, change-password, JWKS)
- **Feature**: `AuthnUsers` and `AuthnRefreshTokens` DynamoDB tables with streams enabled
- **Feature**: AWS KMS-backed JWT signing (RS256 via `RSASSA_PKCS1_V1_5_SHA_256`)
- **Feature**: Stream handler publishes `user.registered`, `user.enabled`, `user.disabled`, `user.password.changed` events to EventBridge
- **Chore**: `.npmrc` pinning registry to public npm (avoids inherited private registry)
