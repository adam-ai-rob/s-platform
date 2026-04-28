# s-platform — Global AI Agent Rules

This file is read by every AI agent working on any module. Per-module agents also read their module's own `packages/s-{module}/CLAUDE.md`.

## ⚠️ Read First

1. **Platform architecture:** [`./docs/architecture/`](./docs/architecture/README.md) — **read all 12 docs before writing code**.
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

There is no root SST app. Every deployed stage (dev, test, prod, personal, or temporary) boots `platform/` first, then the 4 module apps in `modules/*`.

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

### REST conventions (docs/09, ADR 003)

Every new endpoint MUST follow [`docs/architecture/09-api-conventions.md`](./docs/architecture/09-api-conventions.md). Rules in one line each:

- **Path:** `/{module}/{audience}/{resources}[/{id}][:{action}]` — singular module, `admin`/`user` audience, **plural** resources, Google AIP-136 `:verb` for custom actions.
- **Methods:** `GET/POST/PATCH/DELETE` only. **Never `PUT`.** `201` on create with `Location:` header; `204` on delete; `404` (not `403`) when hiding existence.
- **Lists:** Typesense passthrough — `q`, `filter_by`, `sort_by`, `facet_by`, `page`, `per_page` (≤100), optional `cursor`. Fields whitelisted server-side.
- **Envelope:** single → `{ data }`; list → `{ data, meta: { page, perPage, found, outOf, searchTimeMs, nextCursor?, facets? } }`; errors → `{ error: { code, message, details? } }` in 4xx/5xx only. **Errors never travel with `data`.**
- **JSON:** camelCase, ISO 8601 UTC timestamps paired with `*Ms` int64 epochs for Typesense sort. No URL versioning (`/v1/…` forbidden).
- **Docs:** OpenAPI, Postman, and README endpoint text are client-facing contract docs. Do not mention internal transport workarounds such as `/_actions/`; document AIP-136 actions only as their contracted `:verb` endpoints and avoid ambiguous "public URL" wording on authenticated routes.

Existing non-conforming endpoints (s-user singular paths, list `metadata` envelope) are tracked for retrofit in [#73](https://github.com/adam-ai-rob/s-platform/issues/73). New code MUST NOT copy them.

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

### GitHub and git environment

This repo has `.envrc` to select the correct project-local GitHub/git identity. Always run every `gh` and `git` command through `direnv exec .`, for example:

```bash
direnv exec . gh pr view 123
direnv exec . git status --short --branch
direnv exec . gh api user --jq .login   # verify expected identity
```

Prefer the `gh` and `git` CLIs over GitHub MCP tools for identity-sensitive GitHub/Git operations (PR creation/merge, labels, reviews, branch operations, commits, pushes, deploy branch promotion). Non-interactive shells do not reliably run the direnv shell hook automatically, and MCP servers are started outside the repo-specific direnv context, so this keeps GitHub user and git configuration project-local.

### Branching & PRs

Unless explicitly told otherwise:

1. **Start from a GitHub issue.** Every implementation task needs an issue number before coding. If no issue exists, create or ask for one unless the task is a trivial documentation-only change.
2. **Create a feature branch** from `main` using `<agent>/<issue>-<short-slug>`, where `<agent>` is the AI agent that owns the branch: `codex/` for Codex, `claude/` for Claude, `jules/` for Jules, etc. Example: `claude/107-auth-jwt-env-explicit`. Human-only branches may use any conventional prefix (`fix/`, `feat/`, ...).
3. **Commit to the branch**, never directly to `main` or `stage/*`
4. **Open a PR** targeting `main`
5. **CI runs** (typecheck, lint, unit, integration, contract, contract backwards-compat). Add the `deployed-test` label if you want a real-AWS round-trip against dev before merging; see the PR labels table below.
6. **Start review** - use an independent reviewer agent or human reviewer. The implementer does not self-approve.
7. **Report back** - issues found, decisions, LGTM status
8. **Merge** only after explicit user approval; promote sequentially through `stage/dev`, `stage/test`, and `stage/prod` only when requested

### GPT-driven SDLC naming

Use issue numbers everywhere a human scans history:

| Item | Required format | Example |
|---|---|---|
| Branch | `<agent>/<issue>-<short-slug>` | `codex/105-authz-assignment-value-cap`, `claude/107-auth-jwt-env-explicit` |
| PR title | Conventional Commit title with issue suffix | `security(s-authz): cap assignment scope values (#105)` |
| Commit subject | Same style as PR title; include the issue suffix | `security(s-authz): cap assignment scope values (#105)` |
| PR body | Must close or reference the issue | `Closes #105` |

If a PR spans multiple issues, list all issue numbers in the PR body and put the primary issue in the title/commit subject. Avoid broad multi-issue PRs unless the issues are tightly coupled.

### GPT-driven SDLC roles

For non-trivial work, split the work into separate roles:

1. **Planner** - reads the issue and codebase, produces current behavior, affected files, implementation plan, test plan, contract/docs impact, and risks. Does not edit files.
2. **Implementer** - applies the approved plan, keeps scope narrow, updates tests/docs/contracts, opens the PR, and records validation.
3. **Reviewer** - independently reviews the PR for bugs, security regressions, missing tests, stale docs/contracts, and runtime/deployment risks. Findings are ordered by severity.
4. **CI investigator** - used only when checks fail; inspects logs first, then proposes or applies the smallest fix.
5. **Release manager** - merges only after approval and green checks, promotes through the stage chain (`main` to `stage/dev`, `stage/dev` to `stage/test`, `stage/test` to `stage/prod`) as requested, watches deployments to completion, and reports run links.

### Standard GPT prompts

Planning prompt:

```markdown
Read issue #<issue> and the surrounding code. Do not implement yet.

Produce:
- current behavior summary
- affected modules/files
- implementation plan
- test plan
- docs/contracts that must be updated
- compatibility and deployment risks

Follow existing project patterns. If anything is ambiguous, make the safest assumption and call it out.
```

Implementation prompt:

```markdown
Implement issue #<issue> following the approved plan.

Requirements:
- use branch `<agent>/<issue>-<short-slug>` (e.g. `codex/...`, `claude/...`)
- use PR title and commit subject format `<type>(<scope>): <summary> (#<issue>)`
- keep scope narrow and follow existing project patterns
- update tests, docs, contracts, README, CLAUDE notes, and Postman when client-facing behavior changes
- run relevant validation
- create a PR with `Closes #<issue>`, summary, validation, review notes, and deployment status
- use `direnv exec .` before all `git` and `gh` commands
```

Review prompt:

```markdown
Review PR #<pr> as a senior engineer.

Focus on:
- behavioral bugs
- security regressions
- missing validation
- missing tests
- stale docs/contracts/OpenAPI/Postman
- deployment/runtime risks

List findings first, ordered by severity. Use P1/P2/P3 priorities. If there are no actionable issues, say LGTM and mention residual risk.
```

### PR body template

```markdown
Closes #<issue>

## Summary
- ...

## Validation
- [ ] bun run lint:check
- [ ] bun run typecheck
- [ ] bun run test
- [ ] bun run contracts:build
- [ ] GitHub CI

## Review Notes
- Independent GPT/human review status:
- Findings fixed or intentionally not fixed:

## Deployment
- Not deployed yet.
```

### Legacy branch format

Older branches used `fix/...` or `feat/...`. New AI-agent implementation work uses `<agent>/<issue>-<short-slug>` (`codex/`, `claude/`, ...) unless the user explicitly requests a different prefix.

### Release notes

Every PR updates `RELEASE_NOTES.md` under `## Unreleased`:

```markdown
## Unreleased

### Changes
- **Feature**: Short description (#<issue>, PR #N)
- **Fix**: Short description (#<issue>, PR #N)
- **Breaking**: Short description (#<issue>, PR #N) - requires approval
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
- Commit messages: imperative, concise subject line
- Implementation commit subjects must include the GitHub issue number: `<type>(<scope>): <summary> (#<issue>)`
- Use the same subject style for PR titles so squash merges preserve the issue reference
- Reference the PR number only when there is no issue number and the PR itself is the durable reference

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
