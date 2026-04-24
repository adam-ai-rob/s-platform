# {module-name} — AI Agent Rules

This module is owned by a dedicated AI agent. Read this file + the [platform CLAUDE.md](../../CLAUDE.md) + [architecture docs](../../docs/architecture/README.md) before making changes.

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

TODO: choose the module's permission model and keep this table aligned with `functions/src/api.ts`.

Default convention for a resource-scoped module:

| Permission | Scope | Role template |
|---|---|---|
| `{module}_superadmin` | global | `[{ id: "{module}_superadmin" }]` |
| `{module}_admin` | value-scoped resource IDs | `[{ id: "{module}_admin", value: [] }]` |

For a global-only module, keep `{module}_superadmin` as the admin gate and either delete `{module}_admin` or document why it is global:

| Permission | Scope | Role template |
|---|---|---|
| `{module}_superadmin` | global | `[{ id: "{module}_superadmin" }]` |
| `{module}_admin` | global | `[{ id: "{module}_admin" }]` |

**Scoped-permission enforcement:** the controller (route) layer extracts the target resource id and checks `user.permissions` with `@s/shared/auth` helpers. The service layer stays permission-agnostic.

## Access Matrix

TODO: replace `resources` with the module's plural resource name and tighten the roles before implementation.

| Audience | Route | `{module}_superadmin` | `{module}_admin` scoped to id | No scope |
|---|---|---:|---:|---:|
| admin | `POST /{module}/admin/resources` | 201 | 403 by default | 403 |
| admin | `GET /{module}/admin/resources/{id}` | 200 | 200 | 403 |
| user | `GET /{module}/user/resources/{id}` | 200 if user-visible | 200 if user-visible | 404 |

User-audience routes return 404, not 403, when a resource is hidden from the caller. Do not leak existence.

## API Surface

- `GET /health` — platform standard (handled by createApi)
- `GET /info` — platform standard
- `GET /openapi.json` — platform standard
- `GET /docs` — platform standard
- TODO: list custom routes. Mount them under `/admin` and `/user` — see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md) for the full URL shape, list DSL, envelope, and headers.
- `POST /{module}/admin/resources` — scaffold admin create route, superadmin-gated, returns `201` with `Location`
- `GET /{module}/user/resources/{id}` — scaffold user read route, with 404-not-403 hiding guidance

See generated `/openapi.json` for the full contract.

## REST conventions

Follow [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). URL shape is `/{module}/{audience}/{resources}[/{id}][:{action}]` (plural resources, `admin`/`user` audience, Google AIP-136 verbs). Response envelope is `{ data }` / `{ data, meta }` / `{ error }`. No `PUT`. No URL versioning.

The `:verb` workaround is opt-in. Uncomment `enableAip136Actions(app)` in `functions/src/api.ts` only when the module adds custom actions such as `POST /{module}/admin/resources/{id}:archive`.

## Running Locally

```bash
bun sst dev --stage $USER   # from monorepo root
```

Your module's Lambda code runs locally and connects to your personal AWS stage.

## Tests

```bash
bun test packages/{module-name}                    # unit
STAGE=$USER bun test packages/s-tests -t {module}  # journey
```

## Change Rules

- **Any response schema change** requires approval before merging.
- Updates to permissions, events published, or topics REQUIRE matching updates to `functions/src/api.ts` `ApiMetadata`.
- Updates to the `/info` contract = update this file's Events and Permissions tables in the same PR.
