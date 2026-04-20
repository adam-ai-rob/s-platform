# Release Notes

Versioning: **CalVer** (`vYYYY.MM.N`). Releases cut on merge to `stage/prod`.

## Unreleased

### Changes
- **Feature**: Phase 3 part 3 — `modules/s-authn/`, `modules/s-user/`, `modules/s-group/` are now each independently-deployable SST apps. Same pattern as `modules/s-authz/`: platform primitives (gateway id + url, event bus name/ARN, alarms topic ARN) come from SSM, route registration is raw Pulumi against the platform-owned gateway, cross-app IAM is declared explicitly. s-authn additionally reads `jwt-signing-key-arn` from SSM to attach a scoped `kms:Sign` + `kms:GetPublicKey` policy on the API Lambda. s-user and s-group subscribe to `user.registered` on the platform event bus for profile provisioning and email-domain group assignment. `AUTHZ_VIEW_TABLE_NAME` + `dynamodb:GetItem` on the table ARN flow into every module's API Lambda at deploy time from s-authz's SSM outputs — the old `import { authzViewTable } from "./s-authz"` coupling is gone. Validated end-to-end on the `phase3-dev` scratch stage — all three modules deployed cleanly alongside the existing `platform/` + `modules/s-authz/` apps; `/health` returns 200 on all four modules via the shared gateway; `packages/s-tests/src/journeys/auth.journey.test.ts` hits 12/12 pass in 3.6s (after warming the cold-start chain with one manual register — on a brand-new stage three cold Lambdas fire in series and can push the first register's event-propagation latency over the 15s `eventually()` window). Runbook updated with the warm-up procedure. Root `sst.config.ts` + `infra/` still unchanged; the final cut-over PR moves existing stages off the root config. (Issue #46)
- **Feature**: Phase 3 part 2 — `modules/s-authz/` is now an independently-deployable SST app (`@s/module-s-authz`). Reads platform ARNs from SSM at deploy time (gateway id, gateway url, event bus name/ARN, alarms topic ARN), creates its own `AuthzRoles` / `AuthzUserRoles` / `AuthzGroupRoles` / `AuthzView` DDB tables + API/stream/event Lambdas + DLQs, and registers `ANY /authz/{proxy+}` against the platform-owned API Gateway via raw Pulumi (`aws.apigatewayv2.Integration` + `Route` + scoped `Lambda.Permission`). Also publishes `/s-platform/{stage}/authz-view-table-name` + `authz-view-table-arn` so s-authn / s-user / s-group can pick up the cross-module table without a code-level import. Validated end-to-end on a `phase3-dev` scratch stage: 23 resources from `platform/`, 52 from `modules/s-authz/`, `GET /authz/health` returns 200, `/authz/info` correctly returns 401 without a JWT. Root `sst.config.ts` + `infra/s-authz.ts` are untouched; existing stages keep deploying the old way. Runbook updated with the validated commands and a troubleshooting entry for the SST nested-install private-mirror gotcha. (Issue #46)
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
