# Release Notes

Versioning: **CalVer** (`vYYYY.MM.N`). Releases cut on merge to `stage/prod`.

## Unreleased

### Changes
- **Feature**: Phase 3 scaffolding — new `platform/` SST app (Tier 1) owning API Gateway v2, EventBridge bus + archive, KMS JWT signing key, SNS alarms topic, DNS + cert; publishes outputs to SSM `/s-platform/{stage}/*` for module SST apps to consume. New `packages/infra-shared/` workspace hosts the DLQ + alarm wiring and the SSM read/write helpers shared by the platform tier and (future) module tiers. Root `sst.config.ts` + `infra/` are untouched — existing stages keep deploying the old way until follow-up PRs migrate each module to its own SST app (s-authz → s-authn/s-user/s-group). New runbook `docs/runbooks/fresh-stage-bootstrap.md` documents the deploy order for fresh stages. (Issue #46)
- **Docs**: Vendored architecture docs into the monorepo at `docs/architecture/` and `docs/setup/` (previously in the sibling `adam-ai-rob/s-architecture` repo, which will be deleted). Root `CLAUDE.md`, module CLAUDE.md files, templates, and `infra/domains.ts` now reference the in-repo paths.
- **Docs**: Added `packages/shared/CLAUDE.md` and `packages/s-tests/CLAUDE.md` so every package in `packages/` now has its own agent contract; module-scoped agents have a tight, explicit reading list.
- **Docs**: Root `CLAUDE.md` "Read First" section now spells out the per-module reading list explicitly.
- **Feature**: `@s/shared/testing` — module integration test harness (local DynamoDB, table factory, AuthzView stub, JWT/JWKS stub, Hono app invoker). First integration test lands in `packages/s-user/tests/integration/`. New `bun run test:integration` task wired into Turbo and CI (CI step uses `setup-java@v4` to supply the JVM for local DynamoDB).
- **Feature**: `@s/shared/ddb` client now honors `DDB_ENDPOINT` env var to point at a local DynamoDB instance — used by the testing harness, no effect on deployed Lambdas.
- **Feature**: Integration tests for s-authn (3 tests), s-authz (3), s-group (3), s-user (5). `packages/s-authn/core/src/tokens/token.service.ts` exports `__setSignJwtForTests` / `__setJwksProviderForTests` so tests can bypass real KMS. JWT stub in `@s/shared/testing` grew a `signPayload(...)` + `getJwks()` pair to match s-authn's signer signature.
- **Feature**: Phase 2 contracts pipeline. Each module declares its published events as Zod schemas in `packages/s-{module}/core/src/events.ts`. `scripts/build-contracts.ts` (run via `bun run contracts:build`) walks each module, imports its Hono app + event catalog, and emits `contracts/openapi.json` + `contracts/events.asyncapi.json` — committed to git as the versioned artifact. `@s/shared/events`'s `publishEvent(...)` accepts an optional `schema` and validates the payload before `PutEvents` — malformed events throw before they can reach consumers. First consumer contract test lands in `packages/s-user/tests/contract/` — it loads s-authn's AsyncAPI example for `user.registered` and replays it through s-user's event handler. New Turbo task `test:contract` + root script `bun run test:contract`.

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
