# Release Notes

Versioning: **CalVer** (`vYYYY.MM.N`). Releases cut on merge to `stage/prod`.

## Unreleased

### Changes
- **Docs**: Vendored architecture docs into the monorepo at `docs/architecture/` and `docs/setup/` (previously in the sibling `adam-ai-rob/s-architecture` repo, which will be deleted). Root `CLAUDE.md`, module CLAUDE.md files, templates, and `infra/domains.ts` now reference the in-repo paths.
- **Docs**: Added `packages/shared/CLAUDE.md` and `packages/s-tests/CLAUDE.md` so every package in `packages/` now has its own agent contract; module-scoped agents have a tight, explicit reading list.
- **Docs**: Root `CLAUDE.md` "Read First" section now spells out the per-module reading list explicitly.
- **Feature**: `@s/shared/testing` — module integration test harness (local DynamoDB, table factory, AuthzView stub, JWT/JWKS stub, Hono app invoker). First integration test lands in `packages/s-user/tests/integration/`. New `bun run test:integration` task wired into Turbo and CI (CI step uses `setup-java@v4` to supply the JVM for local DynamoDB).
- **Feature**: `@s/shared/ddb` client now honors `DDB_ENDPOINT` env var to point at a local DynamoDB instance — used by the testing harness, no effect on deployed Lambdas.

## v2026.04.1 — 2026-04-17

First prod release — foundation + Phase 1 of all four modules.

### Changes
- **Chore**: Initial monorepo scaffold — SST v3, Bun, Biome, Turborepo
- **Chore**: Shared API Gateway, EventBridge bus, KMS signing key (infra)
- **Chore**: `@s/shared` skeleton (errors, logger, trace, HTTP factory)
- **Chore**: GitHub Actions workflows — CI, deploy, per-PR stages
- **Chore**: CODEOWNERS setup for maintainer review
- **Chore**: `.npmrc` pinning registry to public npm (avoids inherited private registry)
- **Feature**: `@s/shared/ddb` — `BaseRepository`, client singleton, pagination helpers, PATCH semantics (null/""/[] → REMOVE)
- **Feature**: `@s/shared/events` — `PlatformEvent` envelope, `publishEvent()` for EventBridge, idempotency helper scaffold
- **Feature**: `@s/shared/auth` — JWT verify with remote JWKS, in-memory token cache, `authMiddleware` + `requirePermission` / `requireSelfOrPermission` / `requireSystem`
- **Feature**: `/info` endpoint protected by `authMiddleware`
- **Feature**: `packages/s-tests` workspace package — stage URL resolver, typed fetch client, `eventually()` helper
- **Feature**: `s-authn` module ported from GCP/Astra to AWS/DynamoDB/SST (Phase 1 — register, login, refresh, logout, change-password, JWKS)
- **Feature**: `AuthnUsers` and `AuthnRefreshTokens` DynamoDB tables with streams enabled
- **Feature**: AWS KMS-backed JWT signing (RS256 via `RSASSA_PKCS1_V1_5_SHA_256`)
- **Feature**: Stream handler publishes `user.registered`, `user.enabled`, `user.disabled`, `user.password.changed` events to EventBridge
- **Feature**: `s-user` module (Phase 1) — profile CRUD, auto-creation on `user.registered` event
- **Feature**: `s-authz` module (Phase 1) — roles, user-role assignments, materialized `AuthzView`, event-driven view rebuild on user/group lifecycle events
- **Feature**: `s-group` module (Phase 1) — groups, memberships, email-domain auto-assignment on `user.registered`, membership activated/deactivated events
- **Feature**: `@s/shared/auth` middleware reads permissions from `AuthzView` (owned by `s-authz`) via SST-linked table name
- **Feature**: First real e2e journey test — register → profile provisioning → permissions lookup → profile update → password change → old-password rejection → refresh → JWKS → cross-module /health
