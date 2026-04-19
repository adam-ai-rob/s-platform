# @s/tests — End-to-End Journey Tests

Integration tests that exercise the platform across modules. Runs against a **deployed stage** — there's no local mock here. This is by design: tests should fail for the same reasons users fail, not because of mock drift.

## Running

```bash
# Against dev
STAGE=dev bun test --timeout 60000

# Against test
STAGE=test bun test --timeout 60000

# Against a PR stage
STAGE=pr-42 bun test --timeout 60000

# Against prod (read-only tests only)
STAGE=prod bun test --timeout 60000 --filter=read-only
```

From the monorepo root:

```bash
bun run test:e2e   # defaults to STAGE=dev
```

## Writing a Journey

One file per user flow in `src/journeys/`. Each file tests a **complete path**:

- Register → verify email → login → fetch profile (`auth.journey.test.ts`)
- Create group → add user → user gets group permissions (`group-membership.journey.test.ts`)

Use the typed client in `src/client.ts` — it imports Zod schemas from each module so requests/responses are fully typed.

Example:

```typescript
import { describe, expect, it } from "bun:test";
import { createTestClient } from "../client";

describe("auth: register → login → profile", () => {
  const client = createTestClient();
  const email = `test-${Date.now()}@example.com`;

  it("registers a user", async () => {
    const res = await client.authn.register({ email, password: "Test1234!" });
    expect(res.data.id).toBeDefined();
  });

  it("logs in", async () => {
    const res = await client.authn.login({ email, password: "Test1234!" });
    expect(res.data.accessToken).toBeDefined();
  });
});
```

## Idempotency & Cleanup

Tests **must be re-runnable**. Two patterns:

1. Use unique emails per run: `` `test-${Date.now()}-${crypto.randomUUID()}@example.com` ``
2. Clean up in `afterAll()` — delete created users/groups/etc. via admin endpoints

## Eventually-Consistent Assertions

Events flow through DDB Streams → EventBridge → consumer Lambdas. Allow a window:

```typescript
import { eventually } from "../helpers/eventually";

await eventually(async () => {
  const profile = await client.user.getProfile(userId);
  expect(profile.data.email).toBe(email);
}, { timeout: 10_000 });
```

## Current State

This package is a **skeleton**. It will gain:

- Typed clients generated from each module's OpenAPI spec
- Shared fixtures (admin token, test users, cleanup helpers)
- Journey tests for each module as they come online

No journeys exist yet — this file and the skeleton below are placeholders until the first module (s-authn) is ported.
