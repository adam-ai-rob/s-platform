# Deployment & CI/CD

All modules share the same branching strategy, CI pipeline, and deployment workflow. Infrastructure is managed by SST v3 in the monorepo.

## AWS Accounts

| Account | ID | Purpose | Profile (local) |
|---|---|---|---|
| **itinn-bot** | `058264437321` | Primary deploy target for all stages | `itinn-bot` |
| **common** | `679821015569` | Root DNS zone `smartiqi.com` | `common` |

**Region:** `eu-west-1` for all resources.

## Domain Strategy

Single API Gateway per stage, path-based routing to per-module Lambdas. Skip CloudFront.

**DNS hierarchy:**

```
smartiqi.com                          (Route 53, account: common)
│
├── NS records for s-api.smartiqi.com → account itinn-bot's hosted zone
│
└── s-api.smartiqi.com                (Route 53, account: itinn-bot)
    │
    ├── dev.s-api.smartiqi.com        → API Gateway (stage: dev)
    ├── test.s-api.smartiqi.com       → API Gateway (stage: test)
    └── s-api.smartiqi.com            → API Gateway (stage: prod)
```

**Setup (one-time):**

1. In `common` account: create NS records in `smartiqi.com` hosted zone delegating `s-api.smartiqi.com` to the nameservers of the hosted zone in `itinn-bot`.
2. In `itinn-bot` account: create hosted zone `s-api.smartiqi.com`. SST adds records (`dev`, `test`, root) automatically on deploy.

SST configuration:

```typescript
// infra/domains.ts
const stage = $app.stage;

export function getDomainConfig(): { apiDomain: string } | undefined {
  if (stage === "prod") return { apiDomain: "s-api.smartiqi.com" };
  if (stage === "test") return { apiDomain: "test.s-api.smartiqi.com" };
  if (stage === "dev") return { apiDomain: "dev.s-api.smartiqi.com" };
  return undefined; // pr-N and personal stages use default API Gateway URL
}

// infra/shared.ts
import { getDomainConfig } from "./domains.js";

const domain = getDomainConfig();

export const gateway = new sst.aws.ApiGatewayV2("PlatformGateway", {
  cors: { /* ... */ },
  ...(domain && {
    domain: {
      name: domain.apiDomain,
      dns: sst.aws.dns({ zone: "s-api.smartiqi.com" }),
    },
  }),
});
```

**Per-PR stages** use the default API Gateway URL (`https://{id}.execute-api.eu-west-1.amazonaws.com`) — no custom domain, keeps DNS simple.

## Stages

| Stage | Branch | AWS Account | Domain | Purpose |
|---|---|---|---|---|
| **dev** | `stage/dev` | itinn-bot | `dev.s-api.smartiqi.com` | Integration testing, agent sandbox |
| **test** | `stage/test` | itinn-bot | `test.s-api.smartiqi.com` | Pre-prod validation, full e2e suite |
| **prod** | `stage/prod` | itinn-bot | `s-api.smartiqi.com` | Production |
| **pr-{N}** | pull request | itinn-bot | default APIGW URL | Ephemeral per-PR validation |
| **personal** (`{name}`) | N/A | itinn-bot | default APIGW URL | Developer sandbox via `sst dev` |

## Branching Strategy

```
feature/task-name  ── PR ──► main  ──► stage/dev  ──► stage/test  ──► stage/prod
                              │              │               │              │
                           CI only      deploy dev      deploy test    deploy prod
```

| Branch | Auto-deploys | Purpose |
|---|---|---|
| `main` | No | Default branch, integration point |
| `feature/*` | No | Task development |
| `stage/dev` | Yes | Dev environment |
| `stage/test` | Yes | Test environment |
| `stage/prod` | Yes (canary) | Prod environment |

### Workflow

1. Create `feature/task-name` from `main`.
2. Develop, commit, push.
3. Open PR to `main` — CI runs (typecheck, lint, unit tests).
4. **Per-PR stage** deploys automatically (see below).
5. Integration tests run against PR stage.
6. Review agents iterate until LGTM.
7. Merge to `main`.
8. Fast-forward merge `main` → `stage/dev` — auto-deploys to dev.
9. Validate in dev, run smoke tests.
10. Merge `stage/dev` → `stage/test` — auto-deploys to test; full s-tests journey suite runs.
11. Merge `stage/test` → `stage/prod` — canary deploys to prod.

### Stage-branch discipline

`stage/*` branches are **deployment-only**. Never commit directly. Only fast-forward merge:

```bash
git checkout stage/dev
git merge main --ff-only
git push origin stage/dev
git checkout main
```

## CI Workflow

**File:** `.github/workflows/ci.yml`
**Triggers:** PR to `main`, `stage/*`.

```yaml
name: CI
on:
  pull_request:
    branches: [main, stage/dev, stage/test, stage/prod]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with: { bun-version: latest }
      - run: bun install
      - name: Typecheck
        run: bun run typecheck
      - name: Lint
        run: bun run lint:check
      - name: Unit tests
        run: bun run test
```

All three must pass before PR can merge. Turborepo caches typecheck/lint/test results across runs.

## PR Verification

Every PR goes through three layers of checks, progressively more realistic:

1. **CI only** (always, ~90s): `.github/workflows/ci.yml` — typecheck, lint, unit, integration (dynamodb-local + JWT stub), contract, contract backwards-compatibility. Covers ~80% of regressions without any AWS deploy.

2. **On-demand deployed test** (opt-in per PR via `deployed-test` label): `.github/workflows/pr-deployed-test.yml` — deploys the PR's changed modules to the shared `dev` stage and runs the full auth journey against `dev.s-api.smartiqi.com`. On pass, dev stays at the PR's code (saves a rollback cycle before merge). On fail, `origin/main` is redeployed to dev automatically.

3. **On-demand full journey** (manual): `.github/workflows/full-e2e.yml` — run the journey against dev / test / prod. Useful for confirming a stage is healthy without waiting for a new merge.

There is no automatic per-PR `pr-{N}` stage. That model was tried (retired alongside the Phase-3 SST-app split) and traded for the label-driven approach above: most PRs don't need real AWS verification, and the ones that do get an explicit, more realistic signal via `deployed-test` against the continuously-warm dev stage. See `packages/s-tests/CLAUDE.md` for the full run matrix and the `CLAUDE.md` PR-labels section for usage.

## Main Deploy Workflow

**File:** `.github/workflows/deploy.yml`
**Triggers:** push to `stage/dev`, `stage/test`, `stage/prod`.

```yaml
name: Deploy
on:
  push:
    branches: [stage/dev, stage/test, stage/prod]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{
      github.ref_name == 'stage/prod' && 'prod' ||
      github.ref_name == 'stage/test' && 'test' || 'dev'
    }}
    env:
      STAGE: ${{
        github.ref_name == 'stage/prod' && 'prod' ||
        github.ref_name == 'stage/test' && 'test' || 'dev'
      }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/GitHubActionsRole
          aws-region: ${{ vars.AWS_REGION }}

      - name: Deploy
        run: bun sst deploy --stage $STAGE --print-logs

      - name: Smoke tests
        run: STAGE=$STAGE bun run test:e2e -- --filter=smoke
```

## GitHub Environments

Each stage maps to a GitHub environment with protected vars/secrets:

| Environment | Vars | Secrets | Reviewers |
|---|---|---|---|
| `dev` | `AWS_ACCOUNT_ID=058264437321`, `AWS_REGION=eu-west-1` | — | None (auto-deploy) |
| `test` | same | — | None (auto-deploy) |
| `prod` | same | — | Manual approval gate (recommended) |

## AWS IAM Setup (one-time)

### OIDC Provider

```terraform
# or SST / CDK equivalent — configured once per AWS account
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
```

### GitHubActionsRole

```terraform
resource "aws_iam_role" "github_actions" {
  name = "GitHubActionsRole"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:adam-ai-rob/s-platform:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
  # Scope down after initial deploys — see docs/working/AWS_SETUP.md
}
```

**Tighten permissions later** — SST needs broad permissions for initial deploys; scope to specific resources once stable.

## Canary Deployment (Prod)

Two layers:

### Layer 1 (always on): Staged environment pipeline

Already enforced by branching: `main` → `stage/dev` → `stage/test` → `stage/prod`. The s-tests journey suite must pass at `test` before promoting to `prod`.

### Layer 2 (prod only): Lambda alias weighted traffic + CloudWatch guardrails

For each API Lambda, deploy new version with weighted traffic shift:

```
1. `sst deploy --stage prod` updates Lambda code; new version published (e.g., :42).
2. Alias `live` initially points 100% to :41 (old version).
3. Workflow calls CodeDeploy to start shift:
     10% → :42 / 90% → :41 for 5 min
     50% → :42 / 50% → :41 for 5 min
     100% → :42
4. CloudWatch alarms monitored throughout (5xx rate, p99 latency).
5. On alarm: CodeDeploy auto-rolls back to :41. Workflow fails.
6. On clean completion: workflow succeeds.
```

**SST configuration:**

```typescript
export const authnApi = new sst.aws.Function("AuthnApi", {
  handler: "packages/s-authn/functions/src/handler.handler",
  // ... links, env ...
  versioning: true,
  deploy: $app.stage === "prod" ? {
    strategy: "Canary10Percent5Minutes",
    alarms: ["AuthnApi5xxAlarm"],
  } : undefined,
});
```

**Initial scope:** implement only Layer 1. Add Layer 2 once prod has real traffic + meaningful alarm thresholds. Document the pattern now so agents know it's coming.

## Rollback

### Instant rollback (prod)

If a deploy broke prod, revert the alias to the previous version:

```bash
aws lambda update-alias \
  --function-name s-platform-prod-AuthnApi \
  --name live \
  --function-version <previous-version>
```

Or use AWS Console: Lambda → Versions → route alias to older version. Instant (~1 second).

Automation: `scripts/rollback.sh {stage} {module}` (to be added).

### Full redeploy rollback

For non-Lambda changes (DynamoDB schema, EventBridge rules), revert the git commit and redeploy:

```bash
git revert <bad-commit>
git push origin stage/prod
```

Deploy workflow runs again with reverted code.

**Danger:** some infra changes can't be trivially reverted (deleted tables, removed GSIs). Always check `sst diff` before merging `stage/test` → `stage/prod`.

## Release Versioning (CalVer)

Format: `vYYYY.MM.N`

- `YYYY.MM` = year-month of release
- `N` = sequential release number within that month (starts at 1)

**When to cut:** merge to `stage/prod`.

**How:**

1. Before merging `stage/test` → `stage/prod`, on `stage/prod` branch:
   - Rename `## Unreleased` in `RELEASE_NOTES.md` to `## v2026.MM.N — YYYY-MM-DD`.
   - Add a fresh `## Unreleased` section at the top.
   - Commit: `chore: cut release v2026.MM.N`.
2. Create annotated git tag: `git tag -a v2026.MM.N -m "Release v2026.MM.N"`.
3. Push: `git push origin stage/prod --tags`.
4. Create GitHub Release from the tag (optional, automated via workflow).

## Release Notes

Every PR updates `RELEASE_NOTES.md` under `## Unreleased`:

```markdown
## Unreleased

### Changes
- **Feature**: Add magic-link authentication flow (PR #12)
- **Fix**: Correct CORS headers for OPTIONS preflight (PR #13)
- **Breaking**: Remove deprecated `/auth/old-login` endpoint (PR #14)

## v2026.03.2 — 2026-03-22

### Changes
- **Feature**: ...
```

## Secrets Management

Secrets stored in AWS Secrets Manager, referenced in SST:

```typescript
const sendgridKey = new sst.Secret("SendgridApiKey");

export const emailHandler = new sst.aws.Function("EmailHandler", {
  link: [sendgridKey],
  handler: "...",
});
```

Set per-stage via CLI:

```bash
bun sst secret set SendgridApiKey "SG.xxx" --stage prod
```

Never commit secrets. Never pass via env vars in workflows (use SST linkage).

## Cost Guardrails

Per-stage budget alarms (CloudWatch Billing):

| Stage | Monthly budget |
|---|---|
| dev | $50 |
| test | $50 |
| prod | $500 (adjust as traffic grows) |
| pr-* | — (ephemeral, destroyed at PR close) |

Alert on 80% of budget. Configured in `infra/budgets.ts`.

## Deployment Checklist (new module)

When adding a new module (`s-{name}`), to be deployable:

- [ ] `packages/s-{name}/` scaffolded from template
- [ ] `infra/s-{name}.ts` created and imported in `sst.config.ts`
- [ ] API Gateway routes registered with `/{name}/{proxy+}` path
- [ ] DynamoDB tables defined with streams enabled
- [ ] CODEOWNERS updated
- [ ] `/info` endpoint populated with correct metadata
- [ ] Unit tests in `packages/s-{name}/tests/`
- [ ] Journey test in `packages/s-tests/src/journeys/{name}.journey.test.ts`
- [ ] RELEASE_NOTES.md updated
- [ ] Module README.md written
- [ ] Module CLAUDE.md written (agent instructions)
- [ ] First PR deployed to pr-{N} stage + e2e passes
- [ ] Merged to main, promoted through stages

Run `scripts/new-module.sh {name}` to scaffold the above.
