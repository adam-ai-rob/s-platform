# @s/building

Building CRUD with scoped permissions + Typesense-backed lists.

Part of the [s-platform](../../README.md) monorepo. See [`CLAUDE.md`](./CLAUDE.md) for the AI-agent contract, [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md) for the REST rules this module follows, and the generated `/building/openapi.json` for the full HTTP contract.

## Bounded context

Owns the `Building` aggregate: name, description, worldwide-friendly address, area, population, primary/supported languages, currency, timezone, lifecycle status (`draft` | `active` | `archived`).

Buildings are resource-scoped — a user can be `building_admin` on building A and `building_user` only on building B. Permissions and role assignments are managed in [s-authz](../s-authz/README.md); this module enforces them at the route layer and publishes lifecycle events for downstream consumers.

## Tables

- `Buildings` (PK `buildingId`, GSI `ByStatus` on `status` + `updatedAtMs`, streams enabled)

## Events published

- `building.created`, `building.updated`, `building.activated`, `building.archived`, `building.deleted`

## Endpoints

Admin audience (`/building/admin/*`):

- `POST /building/admin/buildings` — create (superadmin)
- `GET /building/admin/buildings` — list (Typesense-backed)
- `GET/PATCH/DELETE /building/admin/buildings/{id}`
- `POST /building/admin/buildings/{id}:archive` / `:activate` — custom actions

User audience (`/building/user/*`):

- `GET /building/user/buildings` — active + scoped to caller
- `GET /building/user/buildings/{id}`

Plus `/building/health`, `/info`, `/openapi.json`, `/docs`.

## Develop

```bash
bun install
bun run typecheck
bun run test
bun run test:integration   # local DynamoDB + JWT stub
```

## Deploy

```bash
bun run deploy:building -- --stage $USER
```

Requires `platform/` + `modules/s-authz/` already deployed on the same stage — see [`docs/runbooks/fresh-stage-bootstrap.md`](../../docs/runbooks/fresh-stage-bootstrap.md).
