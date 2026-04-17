# s-{module-name} — AI Agent Rules

This module is owned by a dedicated AI agent. Read this file + the [platform CLAUDE.md](../../CLAUDE.md) + [architecture docs](https://github.com/adam-ai-rob/s-architecture/tree/main/docs) before making changes.

## Bounded Context

**What this module owns:**
- TODO: Describe the domain concepts owned by this module (e.g., "user profiles", "group memberships").

**What this module does NOT own:**
- TODO: List related concepts owned by OTHER modules (e.g., "authentication credentials — see s-authn").

## DynamoDB Tables

TODO: list tables defined in `infra/s-{module}.ts` with their primary keys and GSIs.

| Table | PK | SK | GSIs |
|---|---|---|---|
| Example | id | — | ByField |

## Events

### Publishes

TODO: list events this module emits via DDB Streams → stream handler → EventBridge.

| Event | Payload shape | When |
|---|---|---|
| `{module}.{entity}.created` | `{ id, ... }` | On insert |

### Subscribes

TODO: list events this module reacts to.

| Event | Source | Side effect |
|---|---|---|
| `user.registered` | s-authn | Create profile |

## Permissions

TODO: list permissions this module checks.

| Permission | Scope | Used by |
|---|---|---|
| `{module}_admin` | global | `/admin/*` routes |

## API Surface

- `GET /health` — platform standard (handled by createApi)
- `GET /info` — platform standard
- `GET /openapi.json` — platform standard
- `GET /docs` — platform standard
- TODO: list custom routes

See generated `/openapi.json` for the full contract.

## Running Locally

```bash
bun sst dev --stage $USER   # from monorepo root
```

Your module's Lambda code runs locally and connects to your personal AWS stage.

## Tests

```bash
bun test packages/s-{module-name}                  # unit
STAGE=$USER bun test packages/s-tests -t {module}  # journey
```

## Change Rules

- **Any response schema change** requires approval before merging.
- Updates to permissions, events published, or topics REQUIRE matching updates to `functions/src/api.ts` `ApiMetadata`.
- Updates to the `/info` contract = update this file's Events and Permissions tables in the same PR.
