# s-building — AI Agent Rules

Building CRUD: physical location metadata with scoped permissions + Typesense-backed admin/user lists. First resource-scoped module on the platform.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

**REST conventions:** see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). All building endpoints MUST conform: `/{module}/{audience}/{resources}[/{id}][:{action}]` with plural collections, `{data}` / `{data, meta}` envelope, Typesense passthrough filter DSL, no `PUT`, no URL versioning.

## Bounded Context

**What s-building owns:**
- `Building` — a physical location with name, description, address, area, population, languages, currency, timezone, lifecycle status (`draft` | `active` | `archived`)
- Building CRUD API (admin + user audiences)
- Building lifecycle events on DDB Streams → EventBridge
- Typesense `{stage}_buildings` collection (indexed via EventBridge subscriber)

**What s-building does NOT own:**
- User identity / credentials (s-authn)
- Permissions + role assignments (s-authz) — building permissions are registered there
- User profiles (s-user)
- Group membership (s-group)
- Floors / spaces inside a building (future module)

## DynamoDB Tables

| Table | PK | SK | GSIs | Notes |
|---|---|---|---|---|
| `Buildings` | `buildingId` | — | `ByStatus` (hash=`status`, range=`updatedAtMs`) | Streams enabled. GSI is an admin-fallback list path for when Typesense is unavailable. |

## Events

### Publishes (via DDB Streams → stream-handler → EventBridge)

| Event | Trigger |
|---|---|
| `building.created` | DDB stream INSERT |
| `building.updated` | DDB stream MODIFY (non-status changes, or paired with one below on status change) |
| `building.activated` | MODIFY where `status` transitioned to `active` |
| `building.archived` | MODIFY where `status` transitioned to `archived` |
| `building.deleted` | DDB stream REMOVE |

All payloads conform to `PlatformEvent` from `@s/shared/events`.

### Subscribes

None today. Future: may subscribe to `user.registered` if we introduce a "first-building" auto-provision flow.

## Permissions (registered in s-authz)

Registered via the system-role seeds in s-authz (#64). All four permissions + seed roles land together; this module just checks them at the route layer.

| Permission | Scope | Role template |
|---|---|---|
| `building_superadmin` | global | `[{ id: "building_superadmin" }]` |
| `building_admin` | value-scoped (building UUIDs) | `[{ id: "building_admin", value: [] }]` |
| `building_manager` | value-scoped | `[{ id: "building_manager", value: [] }]` |
| `building_user` | value-scoped | `[{ id: "building_user", value: [] }]` |

**Scoped-permission enforcement:** the controller (route) layer extracts the target building id and checks `user.permissions` (matching `id` + value-array membership). The service layer stays permission-agnostic — it receives already-validated/scoped data and just operates on it.

## API Surface

Admin audience (`/building/admin/*`) — filled in by sub-issue #69:

- `POST   /building/admin/buildings` — create (superadmin only; always starts `draft` unless explicit)
- `GET    /building/admin/buildings` — list (Typesense-backed; scope-filtered for non-superadmin)
- `GET    /building/admin/buildings/{id}` — read (superadmin or scoped admin/manager)
- `PATCH  /building/admin/buildings/{id}` — partial update
- `POST   /building/admin/buildings/{id}:archive` — archive (superadmin or scoped admin; manager → 403)
- `POST   /building/admin/buildings/{id}:activate` — activate (same gate as archive)
- `DELETE /building/admin/buildings/{id}` — delete (superadmin or scoped admin; manager → 403)

User audience (`/building/user/*`) — filled in by sub-issue #70:

- `GET /building/user/buildings` — list active scoped buildings; empty scope → 200 with empty list
- `GET /building/user/buildings/{id}` — read active scoped building; 404 (not 403) when hidden or missing

Plus platform-standard `/building/health`, `/info`, `/openapi.json`, `/docs` (handled by `createApi()`).

## Change Rules

- **Response schema changes require approval.** Contract-diff CI gates breaking changes; attach `breaking-api-change` + migration plan to override.
- **Events + permissions in `createApi()` metadata must match reality.** If you add an event or permission, update the `createApi({ ... events, permissions })` block in `functions/src/api.ts` in the same PR — `/info` and the AsyncAPI contract derive from it.
- **`/user/buildings/{id}` returns 404, not 403**, when the caller lacks scope or the building is not active. This is deliberate — do not leak existence. The admin audience returns 403 in equivalent cases.
- **Service layer stays permission-agnostic.** Never import `requirePermission` / `UserContext` into `core/src/**`. Scoped-access filtering belongs in `functions/src/routes/`.
