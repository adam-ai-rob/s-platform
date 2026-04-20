# Local Development Guide

This guide covers everything you need to develop, run, and test modules locally.

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| **Bun** | 1.1+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | 22+ | via `nvm` or `fnm` (bun uses system Node for some tooling) |
| **AWS CLI v2** | Latest | `brew install awscli` |
| **gh CLI** | Latest | `brew install gh` |
| **jq** | Latest | `brew install jq` |

Optional but recommended:

- **Docker** — rarely needed (no containers in deployment), but useful for LocalStack if you want offline DDB
- **Postman / Insomnia** — import `/docs/postman/*.json` collections

## AWS Profile Setup

The `itinn-bot` profile should already be in your `~/.aws/credentials` or `~/.aws/config`:

```ini
# ~/.aws/config
[profile itinn-bot]
sso_start_url = https://...
sso_region = eu-west-1
sso_account_id = 058264437321
sso_role_name = AdministratorAccess
region = eu-west-1
```

Login:

```bash
aws sso login --profile itinn-bot
```

Verify:

```bash
aws sts get-caller-identity --profile itinn-bot
# Should return Account: 058264437321
```

## Clone the Monorepo

```bash
git clone git@github.com:adam-ai-rob/s-platform.git
cd s-platform
```

## Install Dependencies

```bash
bun install
```

This installs for all workspaces (`packages/shared`, `packages/s-authn`, etc.) in one pass. The `bun.lock` file ensures deterministic installs.

## Environment Variables

Copy the example:

```bash
cp .env.example .env.local
```

Edit `.env.local` as needed. Most values are auto-injected by SST via `Resource.*.name` in deployed stages. For local dev:

```bash
# .env.local
STAGE=${USER}                    # personal stage name, e.g., "robert"
AWS_PROFILE=itinn-bot
AWS_REGION=eu-west-1
```

## SST Configuration Check

First-time setup, point SST at the right AWS account:

```typescript
// sst.config.ts (already configured)
export default $config({
  app(input) {
    return {
      name: "s-platform",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "eu-west-1",
          profile: process.env.CI ? undefined : "itinn-bot",
        },
      },
    };
  },
  // ...
});
```

In CI, AWS creds come from OIDC role assumption. Locally, SST uses `AWS_PROFILE=itinn-bot`.

## Running Locally: `sst dev`

SST v3 has a `dev` mode that connects your local Lambda code to deployed AWS resources (DDB tables, EventBridge bus, etc.) for your personal stage.

```bash
bun sst dev --stage ${USER}
```

Replace `${USER}` with your name (e.g., `robert`) so you get an isolated stage.

**What happens:**

1. SST deploys infra for your personal stage (DynamoDB tables, EventBridge bus, etc.) — one-time.
2. API Gateway points at a "live" endpoint that routes to your local Lambda code.
3. You edit code in `packages/s-{module}/` → changes hot-reload instantly.
4. DynamoDB writes go to real AWS tables (your personal stage).
5. Events publish to real EventBridge bus (your personal stage).
6. Logs stream to your terminal from CloudWatch.

**First run takes ~2-3 minutes** (infra provisioning). After that, code changes are instant.

**Teardown** when done:

```bash
bun sst remove --stage ${USER}
```

## Local URL

After `sst dev` starts, it prints the API URL:

```
➜  API: https://abc123.execute-api.eu-west-1.amazonaws.com
```

Use this as your base URL in Postman, integration tests, or `curl`:

```bash
curl https://abc123.execute-api.eu-west-1.amazonaws.com/authn/health
```

## Testing Against a Deployed Stage

To test against an already-deployed stage (dev, test, or a PR stage):

```bash
# Test against dev
STAGE=dev bun run test:e2e

# Test against a PR stage
STAGE=pr-42 bun run test:e2e

# Test against prod (be careful!)
STAGE=prod bun run test:e2e -- --filter=read-only
```

The s-tests package resolves the correct URL per stage via `packages/s-tests/src/config.ts`.

## Unit Tests

```bash
# Run all unit tests
bun test

# Run tests for one module
bun test packages/s-authn

# Watch mode
bun test --watch

# Specific file
bun test packages/s-authn/core/src/auth/auth.service.test.ts
```

### Test conventions

- Test files co-located with source: `auth.service.ts` + `auth.service.test.ts`
- Use `bun:test` (`describe`, `it`, `expect`, `mock`)
- Mock external deps (DDB, KMS, EventBridge) at the module level

```typescript
// packages/s-authn/core/src/auth/auth.service.test.ts
import { describe, it, expect, mock } from "bun:test";

mock.module("../users/users.repository.js", () => ({
  findByEmail: mock(() => Promise.resolve({
    id: "01HXYZ",
    email: "user@example.com",
    passwordHash: "$argon2id$...",
    enabled: true,
  })),
}));

import { login } from "./auth.service.js";

describe("login", () => {
  it("returns tokens for valid credentials", async () => {
    const result = await login("user@example.com", "password123");
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });
});
```

## E2E / Journey Tests

s-tests contains cross-module integration tests that hit a deployed stage:

```bash
STAGE=dev bun run test:e2e
```

s-tests resolves URLs per stage, authenticates as a test user, and exercises full user journeys (register → verify → login → create group → etc.).

**Test conventions:**

- One file per user journey in `packages/s-tests/src/journeys/`
- Use typed HTTP clients (generated from module OpenAPI specs) for all requests
- Tests should be idempotent (re-runnable without cleanup)
- Clean up created entities in `afterAll` hooks

**Example:**

```typescript
// packages/s-tests/src/journeys/auth.journey.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createTestClient } from "../client.js";

describe("auth journey", () => {
  const client = createTestClient();
  const testUser = { email: `test-${Date.now()}@example.com`, password: "Test1234!" };

  it("registers, verifies, logs in, fetches profile", async () => {
    // Register
    const reg = await client.authn.register(testUser);
    expect(reg.data.id).toBeDefined();

    // (Verify email via backdoor in dev stage)
    await client.authn.adminVerifyEmail(reg.data.id);

    // Login
    const login = await client.authn.login(testUser);
    expect(login.data.accessToken).toBeDefined();

    // Fetch profile (tests s-user subscription to user.registered event)
    await eventuallyConsistent(async () => {
      const profile = await client.user.getMyProfile(login.data.accessToken);
      expect(profile.data.email).toBe(testUser.email);
    }, { timeout: 10_000 });
  });

  afterAll(async () => {
    // Clean up — delete test user
  });
});
```

## Type Checking

```bash
# Typecheck all packages (Turborepo caches)
bun run typecheck

# Typecheck one package
bun run typecheck --filter=@s/authn
```

## Linting

```bash
# Lint + auto-fix (what you run before committing)
bun run lint

# Check only (what CI runs)
bun run lint:check
```

Biome handles both linting and formatting. No ESLint or Prettier.

## Common Development Tasks

### Add a new module

```bash
bun run new-module s-notifications
```

This scaffolds `packages/s-notifications/` from the template and creates `infra/s-notifications.ts`. Then:

1. Edit the scaffold (remove TODOs).
2. Deploy to your personal stage: `bun sst deploy --stage ${USER}`.
3. Add journey test in `packages/s-tests/src/journeys/notifications.journey.test.ts`.
4. Commit + open PR.

### Add a new route to an existing module

1. Create/update the Zod schema in `packages/s-{module}/functions/src/schemas/`.
2. Create the route definition + handler in `packages/s-{module}/functions/src/routes/`.
3. Create or update the service function in `packages/s-{module}/core/src/`.
4. Update repository if data access changes.
5. Mount route in `packages/s-{module}/functions/src/api.ts` (usually already done if sub-router is mounted).
6. Add unit test for the service.
7. Add journey test assertion in s-tests.

### Add a new event handler

1. Add event branch in `packages/s-{consumer}/functions/src/event-handler.ts`.
2. Add EventBridge rule in `infra/s-{consumer}.ts`.
3. Write handler function in `packages/s-{consumer}/core/src/`.
4. Test with mock event data (unit) + real event (e2e).
5. Update `/info` endpoint of the consumer (`events.subscribes`).

### Add a new DynamoDB table

1. Define in `infra/s-{module}.ts` with `stream: "new-and-old-images"`.
2. Define entity in `packages/s-{module}/core/src/{entity}/{entity}.entity.ts`.
3. Create repository extending `BaseRepository`.
4. Deploy to personal stage to create the table.

### Debug events locally

With `sst dev` running:

1. Your local Lambda is connected to real AWS EventBridge.
2. Other modules' events flow to your local handler.
3. Add `logger.debug(...)` in your handler for detailed tracing.
4. View logs in your `sst dev` terminal.
5. Also available in CloudWatch under your personal stage.

## Troubleshooting

### `bun install` fails

- Check Bun version: `bun --version` (need 1.1+).
- Delete `node_modules` and `bun.lock`, then `bun install` again.

### `sst dev` fails to deploy

- Check AWS creds: `aws sts get-caller-identity --profile itinn-bot`.
- SSO expired: `aws sso login --profile itinn-bot`.
- Stage conflict: try a different stage name (`bun sst dev --stage ${USER}-alt`).

### API Gateway 403 on custom domain

- Certificate validation takes up to 15 min on first deploy for a stage with custom domain.
- Personal stages don't use custom domains — use the default URL.

### Cannot connect to DynamoDB

- Check env vars: `Resource.{TableName}.name` should be set by SST linkage.
- Verify IAM: deployer role (and your local profile) must have DDB access.

### JWT validation fails

- Check `AUTHN_URL` env var points to s-authn's URL for your stage.
- Verify JWKS endpoint: `curl $AUTHN_URL/authn/auth/jwks`.
- Clear the JWT cache: restart `sst dev`.

### Events not arriving at consumer

- Check EventBridge rule in AWS Console → correct stage bus, correct pattern.
- Check consumer Lambda permissions (`lambda:InvokeFunction` from `events.amazonaws.com`).
- Check DLQ for failures: `aws sqs receive-message --queue-url ...`.

### Ephemeral stage not cleaning up

PRs no longer get automatic `pr-{N}` stages (retired — every PR runs CI locally, and the `deployed-test` label deploys to the shared `dev` instead). If you created a personal stage manually:

- Manual cleanup per module (reverse bootstrap order): `cd modules/s-X && bun sst remove --stage <name>`, then `cd platform && bun sst remove --stage <name>`.

## Keeping Local Dev Fast

- Use `bun test --watch` during TDD.
- Use Turborepo cache (`bun run typecheck` is near-instant after first run).
- Run `bun run lint` in your editor on save (Biome extension) instead of on pre-commit.
- Use `sst dev` live reload; avoid redeploying full stacks for quick iteration.

## IDE Setup

### VS Code

Install extensions:

- **Biome** (`biomejs.biome`) — linting + formatting
- **TypeScript Vue Plugin** (if working on any TS) — better types
- **SST** (`sst-dev.sst`) — SST resource browser

Settings (`.vscode/settings.json` — already checked in):

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[json]": { "editor.defaultFormatter": "biomejs.biome" }
}
```

Disable ESLint and Prettier extensions — they conflict with Biome.

### JetBrains

Install Biome plugin from marketplace. Configure as default formatter.

## What NOT to Run

- ❌ `npm install` / `npm run *` — use `bun`
- ❌ `prettier --write` / `eslint --fix` — use `bun run lint`
- ❌ `tsc --build` — use `bun run typecheck`
- ❌ `sst deploy --stage dev` from your laptop — CI deploys `dev`. Use personal stage instead.
- ❌ `sst deploy --stage prod` from your laptop — **ever**. Prod deploys only via GitHub Actions.

## Getting Help

- Architecture questions: check [01-overview.md](01-overview.md) and siblings
- Module-specific: check `packages/s-{module}/README.md` and `CLAUDE.md`
- AWS issues: check CloudWatch logs first, then #platform-ops channel
- SST issues: [SST docs](https://sst.dev/docs), SST Discord
