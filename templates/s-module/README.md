# {module-name}

TODO: one-paragraph description of the module's bounded context.

## Structure

```
{module-name}/
├── CLAUDE.md              # Agent rules (read first)
├── core/                  # Domain logic — no HTTP concepts
│   └── src/
│       └── {entity}/
│           ├── {entity}.entity.ts       # Type + factory
│           ├── {entity}.repository.ts   # BaseRepository
│           └── {entity}.service.ts      # Business logic
├── functions/             # Lambda handlers
│   └── src/
│       ├── api.ts                       # Hono app (OpenAPIHono via createApi)
│       ├── handler.ts                   # Lambda export
│       ├── stream-handler.ts            # DDB stream → EventBridge
│       ├── event-handler.ts             # EventBridge → side effects
│       ├── routes/
│       └── schemas/
└── tests/                 # Unit tests (co-located per file preferred)
```

## Core vs Functions

- **`core/`** — pure domain logic. Unit-testable. No Hono, no Lambda.
- **`functions/`** — HTTP and event handlers. Imports from `core/`.

## Conventions

See [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md).
