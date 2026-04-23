# @s/shared — AI Agent Rules

Platform-wide utilities imported by every module. **Every other package depends on this one**, so the blast radius of any change here is the whole platform. Edit with care.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

**REST conventions:** see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). `@s/shared/http` (`createApi()`) owns the mandatory endpoints + CORS + error handler and is the single point to enforce envelope + conventions platform-wide — changes here affect every module.

## Scope

This package exports **only generic, domain-agnostic utilities**. Anything that encodes a specific bounded context (authn, authz, user, group, …) belongs in that module, never here.

Allowed surface (see `package.json` `exports`):

| Subpath | Purpose |
|---|---|
| `@s/shared` | Re-exports of common types + utilities |
| `@s/shared/errors` | `DomainError` hierarchy, global error handler mapping |
| `@s/shared/logger` | Structured CloudWatch JSON logger — use instead of `console.log` |
| `@s/shared/trace` | X-Ray / correlation-id helpers |
| `@s/shared/http` | `createApi()` factory, platform-standard `/health` `/info` `/openapi.json` `/docs`, CORS, auth middleware |
| `@s/shared/auth` | JWT verify against remote JWKS, `authMiddleware`, `requirePermission`, `requireSelfOrPermission`, `requireSystem` |
| `@s/shared/events` | `PlatformEvent` envelope, `publishEvent()` for EventBridge, idempotency helpers |
| `@s/shared/ddb` | `BaseRepository`, DDB document client singleton, pagination + PATCH helpers |
| `@s/shared/types` | Shared TypeScript types (request context, AWS event shapes) |

## Hard rules

- **Never import from any `packages/s-*` module.** Shared code must not know about any specific module. If you're tempted to, the logic belongs in that module.
- **No business logic.** No per-module error subclasses, no per-module event shapes, no per-module permissions vocabulary. Those live in the owning module.
- **No `DynamoDBClient` instantiation outside `src/ddb/`.** Every module uses `BaseRepository` from here; direct DDB SDK access elsewhere is forbidden (root `CLAUDE.md`).
- **No `console.log()` — ever.** Use `@s/shared/logger`. This applies inside shared itself too.
- **`createApi()` owns `/health`, `/info`, `/openapi.json`, `/docs`.** Modules must not hand-roll these endpoints. Any change to the standard endpoint shape goes here and must be announced.
- **Framework errors are framework's problem.** Validation failures from `zod-openapi` are handled automatically; do not log them here or in modules.

## Change rules (because every module depends on you)

- **Additive changes are safe** — new subpath exports, new helper functions, new optional parameters.
- **Signature changes to existing exports are breaking** — bump every caller in the same PR. Run `bun run typecheck` at the monorepo root to confirm no module is left broken.
- **Changes to `createApi()` default behavior** (CORS, error handler, mandatory endpoints) require explicit approval — they silently change every module's public surface.
- **Changes to `PlatformEvent` envelope** are cross-module breaking changes — coordinate with every subscriber, update `docs/architecture/05-events-and-messaging.md`, approval required.
- **Changes to `BaseRepository` PATCH semantics (null/""/[] → REMOVE)** are silent data-integrity changes — approval required, note in `RELEASE_NOTES.md`.
- **CORS is platform policy (wildcard + `credentials: false`).** Do not change. Reviewers must not flag it.

## Structure

```
shared/
├── CLAUDE.md              # This file
├── package.json           # @s/shared — exports map is the public contract
├── src/
│   ├── index.ts           # Re-exports
│   ├── auth/              # JWT verify, authMiddleware, requirePermission, ...
│   ├── ddb/               # BaseRepository, document client, pagination
│   ├── errors/            # DomainError hierarchy + error handler
│   ├── events/            # PlatformEvent envelope, publishEvent, idempotency
│   ├── http/              # createApi() factory — owns /health /info /openapi.json /docs
│   ├── logger/            # Structured CloudWatch logger
│   ├── trace/             # X-Ray + correlation-id
│   └── types/             # Shared TS types (request context, AWS event shapes)
└── tests/                 # Unit tests co-located alongside source preferred
```

## Tests

```bash
bun test packages/shared                    # unit
bun run typecheck                            # validates all modules still compile with current exports
```

Every signature change should be covered by a unit test in the same PR.

## Forbidden

- ❌ Importing from `packages/s-*`
- ❌ Per-module `DomainError` subclasses (those live in the module that throws them)
- ❌ Per-module event payload shapes (those live in the emitting module)
- ❌ Direct `DynamoDBClient` usage outside `src/ddb/`
- ❌ `console.log` — use `src/logger`
- ❌ Inlining AWS SDK calls — go through adapters / helpers
- ❌ Hand-rolled `/health` / `/info` endpoints — `createApi()` provides them
