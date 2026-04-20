# ADR 001 — Per-Module SST Apps + Contracts

**Status:** Accepted. Realized 2026-04 across PRs
[#48](https://github.com/adam-ai-rob/s-platform/pull/48) (platform/ tier +
`@s/infra-shared`), [#49](https://github.com/adam-ai-rob/s-platform/pull/49)
(s-authz migration), [#50](https://github.com/adam-ai-rob/s-platform/pull/50)
(s-authn / s-user / s-group migrations),
[#51](https://github.com/adam-ai-rob/s-platform/pull/51) (root SST config
deleted, all stages cut over), [#52](https://github.com/adam-ai-rob/s-platform/pull/52)
(on-demand full-e2e workflow), [#53](https://github.com/adam-ai-rob/s-platform/pull/53)
(contract backwards-compat enforcement + opt-in deployed-test workflow),
[#55](https://github.com/adam-ai-rob/s-platform/pull/55) (retired
per-PR ephemeral stages in favour of the label-driven flow).

**What this document is.** The original working plan, drafted Q1-2026
before any of Phase 3 landed. Preserved here as a decision record so the
trade-offs, alternatives considered, and the "why" behind the realized
architecture survive for future re-evaluation.

**What deviated from this plan when realized:**

- **Phase 4 was not implemented as originally proposed.** This doc's
  Phase 4 described a path-scoped `pr-stage.yml` matrix (detect changed
  modules, deploy only those to ephemeral `pr-{N}` stages, nightly full
  journey). In practice we chose a simpler path: kept CI as the primary
  per-PR signal (~90s, zero AWS), added a `deployed-test` PR label that
  deploys the PR's changes to the shared `dev` stage with no rollback
  on success (see #53), and retired the ephemeral-per-PR model entirely
  (see #55). Rationale: solo-agent / sequential-PR scale doesn't justify
  the matrix complexity, and the `dev`-borrow pattern gives a more
  realistic signal against continuously-warm Lambdas. Revisit if
  parallel work becomes common.
- **No AsyncAPI S3 publishing.** Phase 2 shipped AsyncAPI artifacts
  committed to git instead of uploaded to `s3://s-platform-contracts-*`.
  Simpler, versioned-by-git, sufficient for the current consumer model
  (in-repo only). S3 publishing can land later if external consumers
  appear.
- **`full-e2e.yml` is on-demand only, not nightly.** Automation
  (post-deploy gate, release-tag trigger) is intentionally deferred —
  see #52.

The doc below is unedited from its last working-draft state. Where it
contradicts the realized architecture, the realized architecture wins;
the commit log + release notes are the authoritative history.

---

## Context

The platform currently ships as one SST app (`sst.config.ts` imports all four `infra/s-*.ts` files). Every PR and every stage deploy touches all modules. The single end-to-end journey test in `packages/s-tests/src/journeys/auth.journey.test.ts` exercises all four modules — it ran 12 tests in ~4s today, but at 20 modules it will grow into a multi-minute blocking step per PR, and every module change will drag unrelated modules through rebuild/redeploy.

Starting conditions that make this upgrade tractable:
- **`packages/*` are already cleanly bounded** — zero cross-module source imports (all cross-module coupling is via `@s/shared`, event bus, or `AUTHZ_VIEW_TABLE_NAME`).
- **Only 3 cross-module infra edges** — s-authn/s-user/s-group each import `authzViewTable` from `infra/s-authz.ts`. Everything else is shared platform resources (gateway, bus, KMS, SNS).
- **OpenAPI is already auto-generated** per module via `packages/shared/src/http/create-api.ts` → `/openapi.json`. One of the two contracts we need is already produced, just not harvested.
- **Per-module unit tests exist** in `packages/s-{module}/tests/`. The integration-test slot is empty — straightforward to add without disturbing existing tests.

Goal of the upgrade: a new module can be developed, tested, and deployed with zero rebuild of unrelated modules; cross-module collaboration happens through two explicit, versioned contracts (OpenAPI for request/response, AsyncAPI for events).

---

## Recommended Architecture: Platform + Modules + Contracts

Three tiers, four testing levels, phased rollout.

### Tier 1 — `platform` SST app (one, stable, rarely deployed)

Contains **only** primitives that must exist before any module boots:

- `PlatformGateway` (API Gateway v2) — routing plane
- `PlatformEventBus` (EventBridge custom bus) + archive
- `JwtSigningKey` + alias (KMS)
- `PlatformAlarms` (SNS) + email subscription
- DNS record + cert for `{stage}.s-api.smartiqi.com`

Outputs exported to **SSM Parameter Store** under `/s-platform/{stage}/*`:
- `gateway-id`, `gateway-url`, `gateway-exec-role-arn`
- `event-bus-name`, `event-bus-arn`
- `jwt-signing-key-arn`, `jwt-signing-key-alias`
- `alarms-topic-arn`

Lives at a new path: `platform/sst.config.ts` + `platform/infra/*.ts`. The existing `infra/shared.ts` moves here, minus anything module-specific.

### Tier 2 — one SST app per module (`modules/s-{name}/`)

Each module owns its own stack end-to-end:
- Module's own `sst.config.ts` (app name e.g. `s-authn`)
- Module's DDB tables, Lambdas, DLQs, stream/event rules
- Looks up shared ARNs from SSM at deploy time (no code-level imports of other modules' infra)
- Registers its routes on the pre-existing shared gateway using `aws.apigatewayv2.Integration` + `Route` against the imported gateway id

**The `authzViewTable` cross-module dependency** is removed from code-level imports. s-authz publishes its table name to `/s-platform/{stage}/authz-view-table-name` on deploy; every other module reads that SSM parameter at deploy time and sets its own `AUTHZ_VIEW_TABLE_NAME` env var. Same runtime behavior, no build-time coupling.

### Tier 3 — published contracts per module

Each module produces and publishes two artifacts per release:
- **`openapi.json`** — already generated; harvest at build time by hitting `/openapi.json` on the locally-started Hono app, OR by running a small script that imports the module's `app` object and calls `getOpenAPIDocument()`. Published to `s3://s-platform-contracts-{stage}/{module}/v{version}/openapi.json`.
- **`events.asyncapi.json`** — NEW. An AsyncAPI 3.0 document describing every event the module publishes, including a JSON Schema per payload. Author alongside each event type; validate emitted events against this schema in the stream handler before `PutEvents`.

Contracts are consumed by:
- **Consumer modules** — subscribe to the producer's AsyncAPI artifact, generate typed payloads for their event handlers
- **Contract tests in CI** — producer validates its emitted events against its own AsyncAPI; consumer validates that a mocked event matching the AsyncAPI example passes through its handler cleanly
- **Humans / AI agents** — a single place to discover what a module offers

### Testing pyramid per module

| Level | Scope | Runs | Where |
|---|---|---|---|
| **Unit** | pure functions, entity tests | every `bun test` | `packages/s-{module}/tests/*.test.ts` (exists today) |
| **Module integration** (NEW) | module's Lambda + own DDB, other modules mocked via contract stubs | PR stage on change | `packages/s-{module}/tests/integration/*.test.ts` |
| **Consumer contract** (NEW) | downstream module validates its handler against an upstream's AsyncAPI example | PR stage on upstream change | `packages/s-{module}/tests/contract/*.test.ts` |
| **Platform journey** (existing, reduced) | full cross-module happy path | nightly + merge-to-main | `packages/s-tests/src/journeys/*.test.ts` |

Module integration tests use a local harness:
- Deploys **only** the module's own stack to a short-lived stage (`pr-{N}-{module}`)
- Creates a minimal "stub AuthzView" table with seeded rows, rather than deploying s-authz
- For event inputs, invokes the Lambda directly with a synthetic EventBridge event payload that passes the upstream's AsyncAPI schema

This reduces per-PR CI time from "deploy 4 modules + 12 tests" to "deploy 1 module + ~10 targeted tests" and scales O(1) with module count.

### CI change-detection

`.github/workflows/ci.yml` (and a new `.github/workflows/module-pr.yml`) detect changed paths:
- `platform/**` → platform tests + platform deploy (dry-run on PR)
- `modules/s-authn/**` or `packages/s-authn/**` → s-authn unit + integration + contract tests, plus consumer contract tests in any module whose AsyncAPI dependency includes s-authn
- Shared changes (`packages/shared/**`) → fan out to all dependent modules

The full `auth.journey` test stops running per-PR. It runs on merge-to-main and nightly as a safety net.

---

## Pros and Cons

### Pros
1. **Deploy independence.** A change in s-user never rebuilds s-authn. Concurrent PRs on different modules no longer collide on shared state.
2. **Bounded blast radius.** A broken module deploy can't hold the platform hostage. Rollback is per-module.
3. **Per-PR CI time is O(1) in module count**, not O(N). The journey test was 4s for 4 modules — it would be 60+s for 40 modules. Module integration + contract tests stay at ~10–30s per PR regardless.
4. **Contracts are first-class.** OpenAPI + AsyncAPI become the integration surface. AI-agent-per-module workflow maps perfectly: each agent owns one module + publishes one pair of contracts.
5. **Clear ownership.** CODEOWNERS already splits by module — this just completes the pattern in infra + CI.
6. **Incrementally adoptable.** Phases 1+2 (tests + contracts) deliver most of the value without the Tier-1/Tier-2 split. We can ship in stages.

### Cons
1. **Complexity cost.** Multiple SST apps, SSM plumbing, contract artifact pipeline. For a 4-module platform this feels heavy; it pays off around 8–10 modules.
2. **Bootstrap ordering.** First deploy of a new stage is now `platform → s-authz → others`. Needs a short runbook.
3. **Gateway is now imported, not created.** All modules need IAM for `apigatewayv2:UpdateRoute` / `CreateIntegration` scoped to the platform-owned gateway. Similar for EventBridge rule creation against the shared bus.
4. **Contract drift risk.** If AsyncAPI isn't validated in CI on every publish + consume, schemas silently diverge. Mitigation: producer validates every emitted event against its own AsyncAPI; consumer contract tests run on upstream PR.
5. **Per-module PR stages cost more AWS.** N modules × M PRs × ephemeral DDB tables. Mitigate with short TTLs, PAY_PER_REQUEST billing (already on), and aggressive teardown on PR close.
6. **Observability gets harder.** 15 modules = 45+ Lambdas. W3C traceparent propagation (already scaffolded) + a shared log aggregator become mandatory, not optional.
7. **Shared gateway ceiling.** Around ~300 routes the shared API Gateway v2 starts creaking. Not a problem for dozens of modules, but worth a "graduate to per-module custom domain" plan for eventual very-large scale.
8. **Two-day-minimum refactor.** Splitting SST apps + introducing SSM + adding contract harness is not a 1-hour change. Realistically 3–5 focused days.

### Alternatives considered and rejected
- **Pact.io** — heavier consumer-driven-contract framework. AsyncAPI + JSON Schema gives us 80% of the value at 20% of the ceremony. Revisit if we grow external consumers.
- **Per-module VPCs / service mesh** — overkill for Lambda-first, event-driven architecture.
- **Nx monorepo** — Turborepo already covers per-package tasks + caching. Nx adds dependency-graph intelligence we don't need yet.
- **Synchronous inter-module RPC (gRPC / tRPC)** — modules communicate only via events or external HTTP. No internal RPC surface, no reason to introduce one.

### Alternative: split each module into its own GitHub repo (polyrepo)

A legitimate further step. Keeping this as an explicit alternative to the recommended monorepo approach.

Layout would become:
- `adam-ai-rob/s-platform` — platform stack only (gateway, bus, KMS, SNS, DNS) + `@s/shared` publishing pipeline
- `adam-ai-rob/s-authn`, `/s-authz`, `/s-user`, `/s-group`, … — one repo per module
- `@s/shared` published to a registry (npm / GitHub Packages) — consumed by version pin

**Pros (vs monorepo-with-per-module-deploy)**
1. **Maximum deploy & CI independence at the VCS layer.** A PR in `s-authn` literally cannot touch `s-group` files.
2. **PR review scope is physically bounded.** Reviewer context narrows to one module.
3. **AI-agent-per-module is cleaner.** Each agent gets its own checkout, issue tracker, release history, branch protection, labels. Zero cross-module context bleed.
4. **Independent versioning & release cadence.** s-authn v2.0 while s-group stays on v1.4.
5. **External ownership possible.** A vendor or separate team can own one module without write access to the others.
6. **Actions-minute quotas are naturally partitioned** (per-repo on free plans, per-org on paid). Solves the budget-exhaustion problem we hit today.
7. **Easier to open-source or extract** a module later as a standalone product.
8. **Issue hygiene.** Bug filed against s-group never clutters s-authn's backlog.

**Cons**
1. **`@s/shared` becomes a published package, not a workspace import.** Every shared-code change is: release shared → wait for publish → bump N modules. Minutes-to-hours instead of one atomic commit. This is the biggest operational cost.
2. **Atomic cross-module refactors disappear.** Renaming an event from `user.registered` → `user.created` is one commit today; in polyrepo it's N coordinated PRs with staged rollouts and backward-compat windows.
3. **Dependency drift.** `@s/shared@1.2` might break in s-group but pass in s-authn. Monorepo prevents this by construction.
4. **Contract sync costs more.** AsyncAPI/OpenAPI artifacts need an external registry (S3 or npm) with versioned consumption in each repo. Upgrade churn across N repos.
5. **GitHub plumbing multiplies.** N copies of: CODEOWNERS, branch protection, secrets, OIDC trust, labels, workflow files, CLAUDE.md. These drift without discipline.
6. **Discoverability drops.** Cross-repo `grep` needs extra tooling (Sourcegraph, meta-scripts). "Where does s-group emit group.user.activated?" gets harder.
7. **Local dev overhead.** Full-stack nightly e2e requires cloning N repos. Needs a meta-runner (`meta`, google `repo`, or a bash script).
8. **Versioning & release notes overhead.** One `RELEASE_NOTES.md` today; N tomorrow. N tag-automation pipelines, N CalVer cadences.
9. **PR cross-referencing is no longer terse.** `#36` becomes `adam-ai-rob/s-authn#36`.
10. **The s-platform monorepo doesn't disappear** — the platform stack still lives somewhere. You're *adding* N repos, not replacing one.
11. **Initial migration is a week of work.** `git filter-repo` per module to preserve history, re-establish OIDC trust per repo, re-wire CI, re-wire contract publishing, re-publish `@s/shared`.
12. **GitHub free-tier limits compound.** Personal-account repo count and per-repo Actions minutes become painful at 10+ modules.

**When polyrepo wins**
- 4+ independent teams (not a solo operator coordinating AI agents)
- One or more modules will be open-sourced or sold
- Different security/compliance domains per module
- Enterprise GH Actions budget that absorbs per-repo coordination overhead
- Release cadence diverges dramatically across modules

**When polyrepo loses**
- Shared code still evolving (our current state — `@s/shared` is only weeks old)
- Small team / solo operator + AI agents — agents coordinate *better* with a single source of truth
- You value atomic refactors more than physical isolation

**Recommendation: stay monorepo through Phases 1–4, design for graduation.** The monorepo-with-per-module-deploy architecture above leaves each module in its own directory with its own SST app, its own tests, and its own published contracts. A future extraction to polyrepo becomes mostly mechanical:
1. `git filter-repo --path modules/s-{module}/ --path packages/s-{module}/` into a new repo
2. Publish `@s/shared` to a registry (one-time cost across the whole platform)
3. Flip module CI from monorepo path-filter to standalone
4. Re-point contract publishing to the registry

Triggers to re-evaluate: when two of these hit simultaneously — an external team takes ownership, a module needs open-source release, or monorepo CI/coordination friction exceeds polyrepo overhead.

---

## Phased Rollout (recommended order)

Each phase ships independently and delivers value even if later phases are deferred.

### Phase 1 — Module integration tests (~1 day)
Scope: add `packages/s-{module}/tests/integration/` + a harness that boots only that module locally.
- Run unit + integration tests in `turbo test` (already wired)
- No infra changes
- No AWS deploy changes
- **Outcome**: per-module signal without per-PR full deploy. Full e2e keeps running nightly until Phase 4.

### Phase 2 — Contract publication (~1–2 days)
Scope: harvest OpenAPI, author AsyncAPI per module, publish to S3.
- Add `bun run contracts:build` task per module (generates both files into `packages/s-{module}/contracts/`)
- Validate emitted events against AsyncAPI in each stream handler (using `@asyncapi/parser` + `ajv`)
- Upload to `s3://s-platform-contracts-{stage}/{module}/` on stage deploys
- **Outcome**: external and internal consumers have a stable reference. Consumer contract tests become possible.

### Phase 3 — Split infra into platform + modules (~2–3 days)
Scope: move `infra/shared.ts` → `platform/infra/*.ts`; one SST app per module.
- Start with **s-authz** (no cross-module infra dependencies)
- Then s-user, s-group (both depend only on s-authz's `AuthzView` — moved to SSM)
- Then s-authn (KMS + AuthzView via SSM)
- Retire top-level `sst.config.ts` and `infra/` directory
- **Outcome**: true deploy independence. Each module has its own `bun sst deploy --stage dev`.

### Phase 4 — Per-module PR stage workflow + change detection (~1 day)
Scope: replace `.github/workflows/pr-stage.yml` with a path-scoped module workflow.
- Matrix job keyed on changed module(s)
- Full journey moves to `.github/workflows/nightly.yml`
- **Outcome**: PR cycle time drops from `min(current) = deploy all + e2e` to `per-module deploy + per-module integration`. GH Actions minutes drop proportionally (relevant given the current budget exhaustion).

---

## Critical Files (today) + Targets (after upgrade)

| Today | After upgrade |
|---|---|
| `sst.config.ts` | Deleted. Replaced by `platform/sst.config.ts` + `modules/s-{name}/sst.config.ts` |
| `infra/shared.ts` | Split → `platform/infra/gateway.ts`, `platform/infra/event-bus.ts`, `platform/infra/kms.ts`, `platform/infra/alarms.ts`. SSM exports added. |
| `infra/s-{name}.ts` | Moved to `modules/s-{name}/sst.config.ts`. `authzViewTable` import replaced with SSM lookup. |
| `packages/s-{module}/` | Unchanged. Add `tests/integration/`, `tests/contract/`, `contracts/` subdirs. |
| `packages/shared/src/events/envelope.ts` | Add runtime payload validation against AsyncAPI-derived JSON Schema. |
| `packages/shared/src/http/create-api.ts` | Minor: ensure `getOpenAPIDocument()` is callable standalone (not via HTTP) for contract harvesting. |
| `packages/s-tests/` | Becomes nightly-only; drop per-PR hook. |
| `turbo.json` | Add `test:integration`, `test:contract`, `contracts:build` task definitions. |
| `.github/workflows/ci.yml` | Path-filtered matrix. |
| `.github/workflows/pr-stage.yml` | Replaced by `module-pr.yml`. |
| `.github/workflows/nightly.yml` | NEW — runs full journey on dev at 02:00 UTC. |

## Verification (end-to-end, after Phase 3)

1. **Deploy independence** — modify `packages/s-user/` only → run `bun sst deploy --stage dev` from `modules/s-user/` → confirm no other module's Lambda version changes (check `aws lambda list-versions-by-function`).
2. **Fresh-stage bootstrap** — from clean AWS account, run `platform/` deploy, then each module in order (`s-authz` → `s-user` → `s-group` → `s-authn`). Run `packages/s-tests/src/journeys/auth.journey.test.ts` — expect 12/12 pass.
3. **Contract validity** — download `s3://s-platform-contracts-dev/s-authn/*/events.asyncapi.json`; validate with `npx @asyncapi/parser`. Emit a `user.registered` event manually via `aws events put-events` with a payload that violates schema — expect the producer's pre-put validation to reject it.
4. **Per-module PR cycle** — open a PR touching only `packages/s-group/`. Verify CI runs s-group unit + integration + s-authz consumer contract (since s-group emits events s-authz subscribes to), but not s-authn or s-user tests.
5. **Budget** — count GH Actions minutes used by a typical PR. Expect ≥50% reduction vs current per-PR full deploy.