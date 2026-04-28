# s-platform

Serverless, event-driven, DDD-based microservice platform on AWS. Monorepo containing all platform modules.

> **Architecture spec:** [`docs/architecture/`](./docs/architecture/README.md) — read this first before contributing.

## Quick Facts

| | |
|---|---|
| **Cloud** | AWS `eu-west-1` |
| **Account** | `058264437321` (itinn-bot) |
| **Domain** | `{stage}.s-api.smartiqi.com` (prod: `s-api.smartiqi.com`) |
| **Runtime** | Bun 1.x / Node.js 22 |
| **IaC** | SST v3 |
| **Stages** | `dev`, `test`, `prod`, plus personal developer stages |
| **Versioning** | CalVer `vYYYY.MM.N` |

## Getting Started

**Prerequisites:** Bun 1.1+, Node 22+, AWS CLI v2 with `itinn-bot` profile configured (SSO).

```bash
# Clone
git clone git@github.com:adam-ai-rob/s-platform.git
cd s-platform

# Install
bun install

# Login to AWS
aws sso login --profile itinn-bot

# Run locally on a personal stage (replace 'robert' with your name)
bun sst dev --stage robert
```

See [`docs/architecture/11-local-development.md`](./docs/architecture/11-local-development.md) for full setup.

## Repo Layout

```
s-platform/
├── infra/                    # SST stack definitions
│   ├── shared.ts             # API Gateway, EventBridge, KMS, domains
│   ├── domains.ts            # Per-stage custom domain config
│   └── s-{module}.ts         # One file per bounded context
├── packages/
│   ├── shared/               # @s/shared — errors, logger, trace, HTTP factory
│   ├── s-authn/              # (Phase 2) Authentication module
│   ├── s-authz/              # (Phase 2) Authorization module
│   ├── s-user/               # (Phase 2) User profiles module
│   ├── s-group/              # (Phase 2) Groups module
│   └── s-tests/              # (Phase 2) End-to-end journey tests
├── templates/
│   └── s-module/             # Scaffold for new modules
├── scripts/
│   └── new-module.sh         # `bun run new-module s-{name}`
├── .github/workflows/
│   ├── ci.yml                 # PR: typecheck + lint + test + contract backwards-compat
│   ├── deploy.yml             # stage/* branches → deploy the 5-app stack
│   ├── pr-deployed-test.yml   # PR label 'deployed-test' → deploy to dev + journey
│   └── full-e2e.yml           # manual dispatch → run journey against dev/test/prod
├── sst.config.ts
├── package.json              # Bun workspace root
├── biome.json
├── tsconfig.base.json
├── turbo.json
├── AGENTS.md                  # Agent entrypoint, points to CLAUDE.md rules
├── CLAUDE.md                 # Global AI agent rules
└── README.md
```

## Common Commands

```bash
bun install                       # Install all workspace deps
bun run typecheck                 # TypeScript check (Turborepo-cached)
bun run lint                      # Biome lint + auto-fix
bun run test                      # Run all unit tests
bun run new-module s-foo          # Scaffold a new module

bun sst dev --stage $USER         # Local dev — live Lambda
bun sst deploy --stage $USER      # Deploy to your personal stage
bun sst remove --stage $USER      # Tear down your personal stage

# CI deploys automatic from stage/dev, stage/test, stage/prod branches.
# Never deploy to dev/test/prod from your laptop.
```

## GPT-Driven Branching & Deploy Workflow

```
codex/105-task   -> PR -> main  -> stage/dev  -> stage/test  -> stage/prod
                              |          |             |             |
                           CI only  deploy dev   deploy test   deploy prod
                                                              (manual approval)
```

- `stage/*` branches are deployment-only. Never commit directly; only fast-forward merge.
- Every PR runs CI. Add the `deployed-test` label when a PR needs a real-AWS round trip against the shared `dev` stage.
- Implementation work starts from a GitHub issue. Branches use `codex/<issue>-<short-slug>`, for example `codex/105-authz-assignment-value-cap`.
- PR titles and implementation commit subjects include the issue number: `security(s-authz): cap assignment scope values (#105)`.
- PR bodies include `Closes #<issue>` plus summary, validation, review notes, and deployment status.
- See [`docs/architecture/10-deployment.md`](./docs/architecture/10-deployment.md).

## Current Status

This repo is being scaffolded. Modules will be added in subsequent PRs:

- [x] Root config (package.json, sst.config.ts, biome.json, turbo.json)
- [x] GitHub workflows (ci, deploy, pr-deployed-test)
- [x] `@s/shared` skeleton (errors, logger, trace, HTTP factory)
- [x] Shared infra (API Gateway, EventBridge bus, KMS)
- [ ] `templates/s-module/` scaffold
- [ ] `scripts/new-module.sh`
- [ ] `@s/shared/auth` — JWT verification, Lambda authorizer
- [ ] `@s/shared/events` — EventBridge publish helper, PlatformEvent envelope
- [ ] `@s/shared/ddb` — BaseRepository
- [ ] `s-authn` module (port from existing)
- [ ] `s-authz`, `s-user`, `s-group` modules
- [ ] `s-tests` — journey tests

## Contributing

1. Start from a GitHub issue with clear acceptance criteria.
2. Create a branch from `main` named `codex/<issue>-<short-slug>`.
3. Make changes; run the relevant validation (`bun run lint:check`, `bun run typecheck`, `bun run test`, contract checks when applicable).
4. Commit with `<type>(<scope>): <summary> (#<issue>)`.
5. Open a PR to `main` with the same title style and `Closes #<issue>` in the body.
6. Get independent GPT/human review, fix valid findings, and wait for green CI.
7. Merge to `main` only after approval.
8. Promote sequentially as requested: fast-forward `main` to `stage/dev`, then `stage/dev` to `stage/test`, then `stage/test` to `stage/prod`; watch each deploy run to completion.

When using `git` or `gh` in this repo, run commands through `direnv exec .` so the project-local identity from `.envrc` is used.

## License

Private. Not for external distribution.
