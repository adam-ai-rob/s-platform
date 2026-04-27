# @s/building

Building CRUD with scoped permissions + Typesense-backed lists. First resource-scoped module on the platform.

Part of the [s-platform](../../README.md) monorepo. See [`CLAUDE.md`](./CLAUDE.md) for the AI-agent contract, [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md) for the REST rules this module follows, and the generated `/building/openapi.json` for the full HTTP contract.

## Bounded context

Owns the `Building` aggregate: name, description, worldwide-friendly address, area, population, primary/supported languages, currency, timezone, lifecycle status (`draft` | `active` | `archived`).

Buildings are resource-scoped — a user can be `building_admin` on building A and `building_user` only on building B. Permissions and role assignments are managed in [s-authz](../s-authz/README.md); this module enforces them at the route layer and publishes lifecycle events for downstream consumers.

## Permissions and roles

Four permissions are registered in s-authz; four matching system roles are idempotently seeded by s-authz's `AuthzSeeds` Lambda on fresh-stage bootstrap.

| Role | Permission template | Scope |
|---|---|---|
| `building-superadmin` | `[{ id: "building_superadmin" }]` | global |
| `building-admin` | `[{ id: "building_admin", value: [] }]` | per-building |
| `building-manager` | `[{ id: "building_manager", value: [] }]` | per-building |
| `building-user` | `[{ id: "building_user", value: [] }]` | per-building |

Assign a user to a role via `POST /authz/admin/users/{userId}/roles/{roleId}`. For scoped roles, include `{ "value": ["<buildingId>", ...] }` in the body — the assignment's `value` is merged with the role template's `value` at view-rebuild time. Re-assigning the same role unions the incoming scope with any existing one (no 409).

Access matrix enforced by this module's route layer:

| Endpoint | Superadmin | Admin (scoped) | Manager (scoped) | User (scoped) |
|---|---|---|---|---|
| `POST /admin/buildings` | ✅ | ❌ | ❌ | ❌ |
| `GET /admin/buildings` | all | only scope | only scope | — (200 empty list) |
| `GET /admin/buildings/{id}` | ✅ | in scope | in scope | — (403) |
| `PATCH /admin/buildings/{id}` | ✅ | in scope | in scope | — (403) |
| `POST /admin/buildings/{id}:archive` | ✅ | in scope | ❌ | ❌ |
| `POST /admin/buildings/{id}:activate` | ✅ | in scope | ❌ | ❌ |
| `DELETE /admin/buildings/{id}` | ✅ | in scope | ❌ | ❌ |
| `GET /user/buildings` | all active | — (200 empty) | — (200 empty) | active + in scope |
| `GET /user/buildings/{id}` | if active | — (404) | — (404) | if active + in scope |

The `/user/*` audience returns **404 instead of 403** on every hidden path — never leaks existence. Empty-scope list calls return a 200 with an empty data array, never a 403.

## Tables

- `Buildings` (PK `buildingId`, GSI `ByStatus` on `status` + `updatedAtMs`, streams enabled)

## Events published

- `building.created`, `building.updated`, `building.activated`, `building.archived`, `building.deleted`

## Endpoints

Admin audience (`/building/admin/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `POST /building/admin/buildings` | `building_superadmin` | Creates a draft building from the request body. Returns `201`, `{ data: building }`, and a `Location` header for the new resource. |
| `GET /building/admin/buildings` | superadmin, scoped admin, or scoped manager | Typesense-backed list. Superadmin sees all buildings; scoped admin/manager callers see only buildings in their assignment `value`. Empty scope returns `200` with an empty list. |
| `GET /building/admin/buildings/{id}` | superadmin, scoped admin, or scoped manager | Returns one building by id. Admin callers outside scope receive `403`; missing buildings return `404`. |
| `PATCH /building/admin/buildings/{id}` | superadmin, scoped admin, or scoped manager | Partially updates non-status building fields and returns `{ data: building }`. Use `:activate` or `:archive` for lifecycle transitions. |
| `POST /building/admin/buildings/{id}:archive` | superadmin or scoped admin | Transitions an active building to `archived`. Returns `409` for illegal status transitions. |
| `POST /building/admin/buildings/{id}:activate` | superadmin or scoped admin | Transitions a draft or archived building to `active`. Returns `409` for illegal status transitions. |
| `DELETE /building/admin/buildings/{id}` | superadmin or scoped admin | Hard-deletes a building and returns `204`; scoped managers and users receive `403`. |

User audience (`/building/user/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `GET /building/user/buildings` | bearer token with `building_user` scope or superadmin | Lists active buildings visible to the caller. Non-superadmin callers see only scoped buildings; empty scope returns `200` with an empty list. |
| `GET /building/user/buildings/{id}` | bearer token with `building_user` scope or superadmin | Returns an active building only when visible to the caller. Missing, inactive, archived, or out-of-scope buildings all return `404`. |

Plus `/building/health`, `/info`, `/openapi.json`, `/docs`.

## Postman

[`docs/postman/building.postman_collection.json`](./docs/postman/building.postman_collection.json) ships every endpoint with variable-substituted `{{baseUrl}}`, `{{accessToken}}`, `{{buildingId}}`. Pick a stage's base URL, paste a JWT obtained via `POST /authn/auth/login`, and work through the collection top-to-bottom.

Common error paths:
- `401` — missing or invalid `Authorization: Bearer <jwt>` header.
- `400` — zod validation failure on body/query/path. `per_page` cap is `≤ 100`; non-superadmin `filter_by` cannot contain `(`, `)`, or `|`.
- `403` — admin audience only: caller lacks the required permission (for that building or globally).
- `404` — user audience: building does not exist, is not `active`, or is not in caller's scope (all collapsed into one response to avoid leaking existence).
- `409` — illegal status transition (e.g. `archived → draft`, not permitted).

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
