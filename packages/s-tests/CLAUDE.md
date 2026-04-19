# @s/tests — AI Agent Rules

End-to-end **journey tests** that exercise the platform across modules. Runs against a **deployed stage** (dev / test / pr-{N} / prod) — there is intentionally no local mock. Tests should fail for the same reasons a real user fails, not because of mock drift.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

## Scope

- Multi-module user flows: register → profile provisioning → permissions lookup → password change → refresh → JWKS → cross-module `/health`
- Eventually-consistent assertions across DDB Streams → EventBridge → consumer Lambdas
- Cross-module contract verification via the typed client (imports Zod schemas from each module)

**Not in scope here:**
- Unit tests — those live co-located in each module's `tests/` folder
- Load / soak / performance tests
- Security / pen tests
- UI tests — no UI to test

## Hard rules

- **Always target a deployed stage.** No in-process mocks. Set `STAGE=<name>` to pick the target. Default for `bun run test:e2e` is `dev`.
- **Every journey must be re-runnable.** Two allowed patterns:
  1. Unique identifiers per run (`test-${Date.now()}-${crypto.randomUUID()}@example.com`)
  2. `afterAll()` cleanup via admin endpoints
- **Use the typed client** in `src/client.ts` — it imports Zod schemas from each module, so a response-schema change breaks the test at build time (fast feedback).
- **Use `eventually()`** for assertions that wait on async event flow. Default window: 10 seconds. Events flow: DDB Streams → EventBridge → consumer Lambda — latency is non-zero.
- **Never hardcode stage URLs.** The stage URL resolver derives the base URL from `STAGE`.
- **No secrets in committed test code.** Test credentials come from environment variables or are generated per run.
- **Prod runs read-only.** If `STAGE=prod`, only run the read-only subset (`--filter=read-only`).

## Structure

```
s-tests/
├── CLAUDE.md              # This file
├── README.md              # Contributor-facing doc
├── package.json
├── src/
│   ├── client.ts          # Typed cross-module HTTP client (imports module Zod schemas)
│   ├── helpers/
│   │   └── eventually.ts  # Retry-until-assertion-passes helper
│   └── journeys/          # One file per user flow — *.journey.test.ts
└── node_modules/
```

## Writing a new journey

1. Create `src/journeys/{flow}.journey.test.ts`. One file per complete user path.
2. Use `createTestClient()` — do not build ad-hoc `fetch()` calls.
3. Generate unique identifiers per run.
4. Wrap async assertions in `eventually()` when events are involved.
5. Register cleanup in `afterAll()`.
6. Keep total runtime per journey under ~60s — hard timeout is applied by `bun test`.

Example skeleton:

```typescript
import { afterAll, describe, expect, it } from "bun:test";
import { createTestClient } from "../client";
import { eventually } from "../helpers/eventually";

describe("user lifecycle", () => {
  const client = createTestClient();
  const email = `test-${Date.now()}-${crypto.randomUUID()}@example.com`;
  let userId: string | undefined;

  it("registers a user", async () => {
    const res = await client.authn.register({ email, password: "Test1234!" });
    expect(res.data.id).toBeDefined();
    userId = res.data.id;
  });

  it("provisions a profile within the eventual-consistency window", async () => {
    await eventually(async () => {
      const profile = await client.user.getProfile(userId!);
      expect(profile.data.email).toBe(email);
    }, { timeout: 10_000 });
  });

  afterAll(async () => {
    if (userId) await client.authn.admin.deleteUser(userId);
  });
});
```

## Running

```bash
bun run test:e2e                                # against dev (default)
STAGE=test    bun test --timeout 60000
STAGE=pr-42   bun test --timeout 60000          # against a PR ephemeral stage
STAGE=prod    bun test --timeout 60000 --filter=read-only
```

A journey run is the acceptance gate for a PR — if the pr-{N} stage journey run fails, the PR should not merge.

## Change rules

- **New journeys**: safe, land alongside any cross-module feature PR.
- **Changes to `client.ts`** that alter request/response shape: only as a reaction to a module response-schema change — which itself requires approval.
- **New helpers** in `src/helpers/`: keep them general. Module-specific helpers live in the module's own test folder, not here.
- **Timeout bumps**: if a journey starts needing > 10s for an eventual assertion, investigate the event path before raising the window.

## Forbidden

- ❌ In-process mocks of any platform service — run against a deployed stage
- ❌ Destructive operations against `prod` — read-only only
- ❌ Hardcoded stage URLs or credentials
- ❌ Tests that depend on other journeys having run first — each journey must be self-contained
- ❌ `console.log` for test output — use assertions; Bun's test runner handles reporting
