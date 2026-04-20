# s-platform — Global AI Agent Rules

This file is read by every AI agent working on any module. Per-module agents also read their module's own `packages/s-{module}/CLAUDE.md`.

## ⚠️ Read First

1. **Platform architecture:** [`./docs/architecture/`](./docs/architecture/README.md) — **read all 11 docs before writing code**.
2. Your module's `CLAUDE.md` (in `packages/s-{module}/`) — declares that module's bounded context, DynamoDB tables, events, permissions, and API surface.
3. [`packages/shared/CLAUDE.md`](./packages/shared/CLAUDE.md) if (and only if) you are touching shared utilities.
4. `packages/shared/src/index.ts` — utilities available to every module.
5. This file.

A module-scoped agent needs only these five reading points — it does not need to read other modules' `CLAUDE.md` files. Cross-module coupling goes through events or HTTP APIs, not shared code.

**Infra-only agents** (deploy-time helpers, SST app config, gateway/bus/KMS/SNS wiring) additionally read:

- [`platform/`](./platform/) — Tier-1 SST app owning API Gateway v2, EventBridge bus, KMS, SNS. Deploys first on any fresh stage.
- [`modules/s-{module}/`](./modules/) — one Tier-2 SST app per module. Each reads platform ARNs from SSM at deploy time.
- [`packages/infra-shared/CLAUDE.md`](./packages/infra-shared/CLAUDE.md) — shared DLQ + SSM helpers used by the platform app and every module SST app.
- [`docs/runbooks/fresh-stage-bootstrap.md`](./docs/runbooks/fresh-stage-bootstrap.md) — deploy order + SSM contract between platform and modules.

There is no root SST app. Every stage (dev, test, prod, pr-{N}, personal) boots `platform/` first, then the 4 module apps in `modules/*`.

## Non-Negotiable Rules

### Layer boundaries (docs/03, docs/07, docs/08)

| Layer | Location | Does | Does NOT |
|---|---|---|---|
| **Routes** | `packages/s-{module}/functions/src/routes/` | Parse input, call ONE service method, format response | Touch DynamoDB, orchestrate services |
| **Services** | `packages/s-{module}/core/src/{feature}/` | Business logic, throw `DomainError`, publish events | Use `c.json()`, call DDB SDK directly |
| **Repositories** | `packages/s-{module}/core/src/{feature}/` | CRUD for ONE table | Business validation, cross-table queries |
| **Adapters** | `packages/s-{module}/core/src/adapters/` | Wrap external services with domain methods | Expose raw SDK calls |

- Routes call **one service method** — no chaining, no orchestration
- Services throw `DomainError` subtypes — never HTTP status codes
- Repositories are **single-table** — no cross-table queries
- Adapters expose **domain methods** — `sendMagicLink(email)` not `ses.sendEmail(payload)`
- No direct `DynamoDBClient` usage outside `packages/shared/src/ddb/` and repositories
- No circular dependencies between services — extract shared logic into a third service

### Mandatory endpoints per module (docs/09)

Every deployed module exposes:

- `GET /health` — public, `{ status: "ok" }`, no deps
- `GET /info` — authenticated, returns service metadata (permissions, events, topics)
- `GET /openapi.json` — auto-generated OpenAPI 3.1
- `GET /docs` — Swagger UI

Use the `createApi()` factory from `@s/shared/http`. **Do not write these endpoints manually.**

### CORS — DO NOT CHANGE

- `Access-Control-Allow-Origin: *` (wildcard). This is a platform requirement.
- `credentials: false` (required for wildcard per CORS spec).
- Auth is JWT bearer tokens in `Authorization` header, not cookies.
- Reviewers: do NOT flag wildcard CORS as a security issue.

### Error handling (docs/07)

- Business errors → throw a `DomainError` subclass in the service layer
- Global error handler in `createApi()` maps them to HTTP
- Routes do NOT catch domain errors — let them bubble
- Unknown errors → 500 with sanitized message in production

### Naming

- Files: `{feature}.service.ts`, `{feature}.repository.ts`, `{feature}.routes.ts`, `{feature}.entity.ts`
- Services/repos: **export functions**, not classes
- Domain errors: `{Thing}Error` extending `DomainError`
- Tests: co-located, `{file}.test.ts`

## Workflow Rules

### Branching & PRs

Unless explicitly told otherwise:

1. **Create a feature branch** from `main` (`fix/...`, `feat/...`)
2. **Commit to the branch**, never directly to `main` or `stage/*`
3. **Open a PR** targeting `main`
4. **CI runs** (typecheck, lint, unit, integration, contract, contract backwards-compat). Add the `deployed-test` label if you want a real-AWS round-trip against dev before merging — see the PR labels table below.
5. **Start review** — spawn reviewer + coder agents
6. **Report back** — issues found, decisions, LGTM status
7. **Merge** only after explicit user approval; FF `stage/dev` from main to deploy

### Release notes

Every PR updates `RELEASE_NOTES.md` under `## Unreleased`:

```markdown
## Unreleased

### Changes
- **Feature**: Short description (PR #N)
- **Fix**: Short description (PR #N)
- **Breaking**: Short description (PR #N) — ⚠️ requires approval
```

### Response schema changes (public API contract)

Response Zod schemas define the public API contract. **Any change requires explicit approval before merging.** Includes:
- Removing/renaming response fields
- Changing field types
- Changing response envelope
- Making required fields optional (or vice versa)

Adding new optional fields is safe but note in the PR description. Reviewers MUST flag any response schema change.

### Contract backwards-compatibility (automated)

`.github/workflows/ci.yml` runs `scripts/contract-diff.ts` on every PR and fails if any module's OpenAPI or AsyncAPI contract removes a path, event, required field, narrows a type, or removes an enum value. These are breaking changes for callers and subscribers. Attach the `breaking-api-change` label to the PR to override — the label **must** be paired with a migration plan in the PR description (e.g. "both `email` and `emailAddress` emitted for two releases; `email` removed in v2026.08"). Additive changes (new endpoint, new optional field, widened enum) pass without a label.

### PR labels

| Label | Effect |
|---|---|
| `deployed-test` | Triggers `.github/workflows/pr-deployed-test.yml` — deploys the PR's changed modules to `dev` and runs the full journey. On pass: dev stays at PR's code (saves a rollback cycle). On fail: dev is restored from `origin/main`. Only ONE PR at a time (shared `touches-dev` concurrency group with the stage/dev deploy workflow). |
| `breaking-api-change` | Overrides the contract backwards-compatibility check. Requires a migration plan in the PR description. |

### Postman collection

When adding/modifying endpoints, update `packages/s-{module}/docs/postman/{module}.postman_collection.json` in the same PR.

### Versioning (CalVer)

Format: `vYYYY.MM.N`. Cut on merge to `stage/prod`.

Process:
1. Rename `## Unreleased` → `## v2026.MM.N — YYYY-MM-DD`
2. Tag: `git tag -a v2026.MM.N -m "Release v2026.MM.N"`
3. Add fresh `## Unreleased` section

### Deployment

`stage/*` branches are **deployment-only** — NEVER commit directly.

```bash
git checkout stage/dev && git merge main --ff-only && git push origin stage/dev && git checkout main
```

## Commands

```bash
bun install
bun run typecheck                  # TypeScript check
bun run lint                       # Biome check + auto-fix
bun run test                       # Unit tests
bun run test:e2e                   # Journey tests (requires deployed stage)

# Deploy — one app at a time. See docs/runbooks/fresh-stage-bootstrap.md
# for the bootstrap order (platform → s-authz → others).
bun run deploy:platform -- --stage $USER
bun run deploy:authz    -- --stage $USER
bun run deploy:authn    -- --stage $USER
bun run deploy:user     -- --stage $USER
bun run deploy:group    -- --stage $USER
```

**Always use `bun` / `bunx`. Never `npm` / `npx`.**

## Commit Rules

- **Never add `Co-Authored-By`** to commit messages
- Commit messages: imperative, concise, 50 char subject line
- Reference PR number when applicable: `feat: add magic-link flow (#12)`

## Forbidden

- ❌ Direct `DynamoDBClient` outside `packages/shared/src/ddb/` and repositories
- ❌ Using `any` type in source code — use `unknown` + type guards
- ❌ Using `as` type casts — let TypeScript infer
- ❌ Inline imports — all imports at top of file
- ❌ `console.log()` in source — use `@s/shared/logger`
- ❌ `npm`/`npx`/`yarn`/`pnpm` — use `bun`/`bunx`
- ❌ Bundling AWS SDK — externalized by SST
- ❌ Logging validation errors — framework handles them
- ❌ String concatenation in logs — use structured fields
- ❌ Cross-module repository imports — use events or HTTP APIs
- ❌ Staging/committing/pushing without explicit user request
