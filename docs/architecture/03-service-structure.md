# Service Structure

Every module in s-platform follows the same file structure and package organization. This consistency makes it easy for any engineering AI agent to navigate a new module after learning one.

## Monorepo Layout (s-platform repo)

```
s-platform/
├── CLAUDE.md                          # Global AI agent rules
├── README.md
├── RELEASE_NOTES.md                   # CalVer release history
├── biome.json                         # Shared Biome config
├── bun.lock
├── package.json                       # Bun workspace root
├── sst.config.ts                      # Top-level SST app
├── turbo.json                         # Task orchestration + caching
├── tsconfig.base.json                 # Shared compiler options
├── tsconfig.json                      # Root project references
├── .nvmrc                             # Node 22
├── .tool-versions                     # bun, node
├── .env.example
├── .github/
│   ├── CODEOWNERS                     # Per-package ownership for AI agents
│   └── workflows/
│       ├── ci.yml                     # PR: typecheck, lint, unit tests
│       ├── deploy.yml                 # stage/* branches → deploy
│       └── pr-stage.yml               # PR open → deploy pr-{N}, close → remove
├── infra/                             # SST stack definitions
│   ├── shared.ts                      # API Gateway, EventBridge bus, KMS, domain
│   ├── s-authn.ts                     # s-authn Lambdas + tables
│   ├── s-authz.ts
│   ├── s-user.ts
│   ├── s-group.ts
│   └── s-{module}.ts                  # One file per bounded context
├── packages/
│   ├── shared/                        # @s/shared — used by every module
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # public exports
│   │       ├── errors/                # DomainError hierarchy
│   │       ├── logger/                # structured CloudWatch logger
│   │       ├── trace/                 # W3C traceparent middleware
│   │       ├── auth/                  # JWT verification SDK, Lambda authorizer
│   │       ├── events/                # PlatformEvent envelope, EventBridge publisher
│   │       ├── ddb/                   # BaseRepository, DDB client singleton
│   │       ├── http/                  # OpenAPIHono factory (/health, /info, /openapi, /docs)
│   │       └── types/                 # Permission, UserContext, shared Zod schemas
│   ├── s-authn/                       # Module: authentication
│   │   ├── package.json
│   │   ├── core/                      # Pure domain logic
│   │   │   └── src/
│   │   │       ├── {entity}/
│   │   │       │   ├── {entity}.entity.ts      # Factory + types
│   │   │       │   ├── {entity}.repository.ts  # BaseRepository extension
│   │   │       │   └── {entity}.service.ts     # Business logic
│   │   │       ├── adapters/                   # External service wrappers
│   │   │       └── events/                     # Event-specific logic
│   │   ├── functions/                 # Lambda handlers
│   │   │   └── src/
│   │   │       ├── api.ts             # Hono handler (all HTTP routes)
│   │   │       ├── stream-handler.ts  # DDB stream processor
│   │   │       ├── event-handler.ts   # EventBridge event consumer
│   │   │       ├── authorizer.ts      # Lambda authorizer (if module-specific)
│   │   │       ├── routes/
│   │   │       ├── schemas/
│   │   │       ├── middleware/
│   │   │       └── types.ts           # AppEnv
│   │   ├── tests/                     # Unit tests co-located with src
│   │   └── CLAUDE.md                  # Module-specific agent rules
│   ├── s-authz/                       # Same structure
│   ├── s-user/
│   ├── s-group/
│   ├── s-{module}/                    # 20+ more over time
│   └── s-tests/                       # E2E journey tests
│       ├── package.json
│       └── src/
│           ├── client.ts              # Typed HTTP clients (imports module Zod schemas)
│           ├── config.ts              # Stage URL resolver
│           ├── setup.ts               # Shared test setup (admin token, etc.)
│           ├── fixtures/              # Test data builders
│           └── journeys/
│               ├── auth.journey.test.ts
│               ├── authz.journey.test.ts
│               └── group-membership.journey.test.ts
├── templates/
│   └── s-module/                      # Scaffold copied when creating new module
├── scripts/
│   ├── new-module.sh                  # Copies templates/s-module/ to packages/s-{name}/
│   ├── deploy-pr-stage.sh             # Ephemeral stage helper
│   └── remove-pr-stage.sh
└── docs/
    ├── architecture/                  # This spec (11 numbered docs + README index)
    └── setup/                         # One-time AWS / GitHub setup runbooks
```

## Monorepo vs Per-Repo

**Chosen: monorepo.**

Reasoning:

- **Shared code** (`@s/shared`) is a workspace dependency — no package publishing needed, changes propagate instantly
- **Cross-module changes** (e.g., evolving the event envelope) land in a single atomic PR
- **Single lockfile** ensures dependency consistency across all modules
- **Single CI pipeline** with Turborepo change detection — only rebuild/test affected packages
- **s-tests** imports from every module to build typed HTTP clients — only works cleanly in-repo
- **Per-PR stage** deploys all changed stacks together from one `sst deploy` invocation

Per-repo works if you have many independent teams. For AI-agent-per-module with clean package boundaries, monorepo is simpler and tighter.

## Per-Module AI Agent Ownership

Each `packages/s-{module}/` has a dedicated AI agent that owns the module. Rules:

### What the agent reads

- Its own package: `packages/s-{module}/**`
- Shared utilities: `packages/shared/**`
- The module's section in [architecture docs](.)
- The module's tests in `packages/s-tests/src/journeys/{module}.journey.test.ts`

### What the agent never reads

- Other modules' internals (`packages/s-{other-module}/core/` or `functions/`)
- They can read another module's published contract (OpenAPI spec, event catalog from `/info` endpoint, exported types)

### What the agent writes

- Code, unit tests, schemas, infra stack (`infra/s-{module}.ts`)
- Updates to `packages/s-tests/src/journeys/{module}.journey.test.ts` for integration coverage
- Module's `CLAUDE.md` with module-specific rules
- Module's `/info` endpoint content (permissions catalog, events published/subscribed)

### CODEOWNERS enforcement

`.github/CODEOWNERS` assigns review rights:

```
/packages/shared/           @robert-hikl
/packages/s-authn/          @agent-authn @robert-hikl
/packages/s-authz/          @agent-authz @robert-hikl
/packages/s-user/           @agent-user  @robert-hikl
/packages/s-group/          @agent-group @robert-hikl
/packages/s-tests/          @all-agents  @robert-hikl
/infra/shared.ts            @robert-hikl
/infra/s-authn.ts           @agent-authn @robert-hikl
```

Cross-module changes require approval from the other agent (or human).

## Per-Module Package Structure

Each module follows this canonical structure:

```
packages/s-{module}/
├── package.json                       # @s/{module}
├── CLAUDE.md                          # Module-specific AI agent rules
├── README.md                          # Module overview, local dev
├── tsconfig.json                      # extends ../../tsconfig.base.json
├── core/
│   └── src/
│       ├── index.ts                   # public exports
│       ├── {entity}/
│       │   ├── {entity}.entity.ts     # Type + factory
│       │   ├── {entity}.repository.ts # BaseRepository subclass
│       │   ├── {entity}.service.ts    # Business logic
│       │   └── {entity}.service.test.ts
│       ├── adapters/                  # External service wrappers (KMS, third-party APIs)
│       │   └── {service}.adapter.ts
│       └── events/                    # Event-specific logic (publishers, handlers)
│           └── {event-name}.handler.ts
└── functions/
    └── src/
        ├── api.ts                     # OpenAPIHono app — HTTP entry point
        ├── handler.ts                 # Lambda export (wraps api.ts via handle())
        ├── stream-handler.ts          # DynamoDB Streams handler
        ├── event-handler.ts           # EventBridge event consumer
        ├── types.ts                   # AppEnv for Hono context
        ├── middleware/
        │   ├── auth.middleware.ts     # Wraps @s/shared auth
        │   └── permission.middleware.ts
        ├── schemas/
        │   └── *.schema.ts            # Zod request/response schemas
        └── routes/
            ├── {feature}.routes.ts
            └── admin.routes.ts
```

## Why Core and Functions Are Separate

Every module splits into two directories:

**`core/`** — pure domain logic.

- Zero HTTP framework dependencies (no Hono, no request/response objects)
- No Lambda-specific code
- Services take plain objects, return plain objects, throw `DomainError`
- Unit-testable without mocking HTTP

**`functions/`** — HTTP/event entry points.

- Lambda handlers (API, stream, event, authorizer)
- OpenAPIHono app with routes, middleware, schemas
- Imports from `core/` — not the other way around

**Benefits:**

1. **Testability** — business logic tested as plain functions
2. **Portability** — if Hono is replaced, only `functions/` changes
3. **Clarity** — agents know where to look: HTTP concerns in `functions/`, domain logic in `core/`
4. **Dependency hygiene** — `core` depends only on `@s/shared` + SDKs; `functions` adds Hono

## Naming Conventions

### Files

- Services: `{feature}.service.ts`
- Repositories: `{feature}.repository.ts`
- Entities: `{feature}.entity.ts`
- Adapters: `{service}.adapter.ts`
- Event handlers: `{event-name}.handler.ts`
- Zod schemas: `{feature}.schema.ts`
- Routes: `{feature}.routes.ts`
- Middleware: `{purpose}.middleware.ts`
- Tests: `{feature}.service.test.ts` (co-located with source)

### Symbols

- Services export functions directly — no classes:
  ```typescript
  export async function login(email: string, password: string): Promise<TokenPair> { }
  export async function register(input: RegisterInput): Promise<User> { }
  ```
- Repositories export functions directly as well
- Factories: `create{Entity}(params): {Entity}` in `.entity.ts`
- Errors: `{Thing}Error` extending a base `DomainError` class
- Types: named after the entity (`User`, `AuthnUser`, `AuthzRole`)

### DynamoDB Tables

Tables are module-scoped. SST-generated physical names include stage suffixes. Logical names in code:

```
{Module}{Entity}
```

Examples:

| Module | Logical name | Physical name (dev) |
|---|---|---|
| s-authn | `AuthnUsers` | `s-platform-dev-authn-users-{hash}` |
| s-authn | `AuthnRefreshTokens` | `s-platform-dev-authn-refresh-tokens-{hash}` |
| s-authz | `AuthzRoles` | `s-platform-dev-authz-roles-{hash}` |
| s-authz | `AuthzView` | `s-platform-dev-authz-view-{hash}` |

Each module writes only to its own tables. The **one exception** is `AuthzView` — written by s-authz, read by all modules.

## AppEnv Pattern

Every module defines an `AppEnv` type for typed Hono context:

```typescript
// packages/s-authn/functions/src/types.ts
import type { UserContext } from "@s/shared/types";

export type AppEnv = {
  Variables: {
    user: UserContext;        // set by auth middleware
    traceId: string;          // set by trace middleware
    spanId: string;
    traceparent: string;
  };
};
```

The OpenAPIHono app is created with this type:

```typescript
const app = new OpenAPIHono<AppEnv>();
```

`c.get("user")` returns a typed `UserContext`. No `as` casts.

## Path Aliases

TypeScript path aliases let `functions/` import from `core/` cleanly:

```json
// packages/s-authn/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@s-authn/core/*": ["./core/src/*"],
      "@s/shared/*": ["../shared/src/*"]
    }
  }
}
```

In code:

```typescript
// packages/s-authn/functions/src/routes/auth.routes.ts
import { login, register } from "@s-authn/core/auth/auth.service.js";
import { DomainError } from "@s/shared/errors";
```

**Use `.js` extensions in imports** (required for ESM). Bun handles TypeScript resolution natively.

## Workspace `package.json`

Each workspace package has its own `package.json`:

```json
// packages/s-authn/package.json
{
  "name": "@s/authn",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./core/*": "./core/src/*.ts",
    "./functions/*": "./functions/src/*.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "biome check --write ."
  },
  "dependencies": {
    "@s/shared": "workspace:*",
    "@hono/zod-openapi": "^0.16.0",
    "@hono/swagger-ui": "^0.4.0",
    "@hono/aws-lambda": "^0.0.5",
    "@aws-sdk/client-dynamodb": "^3.650.0",
    "@aws-sdk/lib-dynamodb": "^3.650.0",
    "@aws-sdk/client-kms": "^3.650.0",
    "zod": "^3.23.0",
    "ulid": "^2.3.0",
    "jose": "^5.6.0",
    "@node-rs/argon2": "^2.0.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.143"
  }
}
```

## Root `package.json`

```json
// package.json (monorepo root)
{
  "name": "s-platform",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "sst dev",
    "deploy": "sst deploy",
    "remove": "sst remove",
    "typecheck": "turbo run typecheck",
    "lint": "biome check --write .",
    "lint:check": "biome check .",
    "test": "turbo run test",
    "test:e2e": "STAGE=${STAGE:-dev} bun test --cwd packages/s-tests",
    "new-module": "./scripts/new-module.sh"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.8.0",
    "@types/node": "^22.0.0",
    "sst": "^3.0.0",
    "turbo": "^2.0.0",
    "typescript": "^5.5.0"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "packageManager": "bun@1.1.0"
}
```

## Creating a New Module

Use the scaffold script:

```bash
bun run new-module s-notifications
```

This:

1. Copies `templates/s-module/` to `packages/s-notifications/`.
2. Replaces `{module}` placeholders with `notifications` / `Notifications`.
3. Creates `infra/s-notifications.ts` from the template.
4. Registers routes in the shared API Gateway (`infra/shared.ts`).
5. Adds entry to CODEOWNERS.
6. Prints next steps (assign agent, add unit tests, deploy to dev).

After the scaffold, the agent for that module takes over.

## Agent Onboarding (per module)

When a new AI agent is assigned to a module, it reads (in order):

1. `docs/architecture/README.md` (platform overview)
2. `docs/architecture/01-overview.md`
3. Its own module's `CLAUDE.md` (module-specific rules)
4. `@s/shared` exports (to know what utilities are available)
5. Its own module's `core/src/index.ts` and `functions/src/api.ts` (current state)
6. Existing unit tests in the module
7. The module's journey test file in `packages/s-tests/src/journeys/`

Everything else is loaded on-demand.
