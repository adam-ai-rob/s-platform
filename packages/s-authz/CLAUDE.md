# s-authz — AI Agent Rules

Authorization: roles, user-role and group-role assignments, materialized `AuthzView` per-user used by every other module's auth middleware.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

**REST conventions:** see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). New endpoints MUST conform; non-conforming legacy paths are tracked for retrofit and MUST NOT be copied into new code.

## Bounded Context

**Owns:** roles, role→permission mappings, role hierarchy, user↔role and group↔role assignments, the materialized `AuthzView`.

**Does NOT own:** users (s-authn), profiles (s-user), group membership (s-group).

## DynamoDB Tables

| Table | PK | GSIs | Notes |
|---|---|---|---|
| `AuthzRoles` | `id` | `ByName` | Role definitions |
| `AuthzUserRoles` | `id` | `ByUserId`, `ByRoleId` | user → role assignments |
| `AuthzGroupRoles` | `id` | `ByGroupId`, `ByRoleId` | group → role assignments |
| `AuthzView` | `userId` | — | Flat materialized permissions per user. Read-only by other modules via `AUTHZ_VIEW_TABLE_NAME` env var shared through SST links. |

## Events

### Publishes

- `authz.role.created`, `authz.role.updated`, `authz.role.deleted` (from `AuthzRoles` stream)
- `authz.view.rebuilt` (from `AuthzView` stream, fires for every rebuild)

### Subscribes

- `user.registered` → create empty `AuthzView` entry
- `user.enabled` → ensure `AuthzView` entry is up to date
- `user.disabled` → clear `AuthzView` permissions (the auth middleware treats missing/empty as deny)
- `group.user.activated`, `group.user.deactivated` → rebuild `AuthzView` for the affected user

## API Surface

- `GET /authz/user/me/permissions` — caller's current permissions (authenticated)
- `POST /authz/admin/roles` — create role
- `GET /authz/admin/roles/{id}` — get role
- `DELETE /authz/admin/roles/{id}` — delete role
- `POST /authz/admin/users/{userId}/roles/{roleId}` — assign
- `DELETE /authz/admin/users/{userId}/roles/{roleId}` — unassign
- Plus platform-standard endpoints

There is no mounted `GET /authz/admin/roles` list endpoint today; the repository
supports listing, but the API has not exposed it yet.

## Change Rules

- Adding/removing permissions from the model requires a full `AuthzView` rebuild — document in the PR.
- Any change to how `AuthzView` is keyed/structured is a breaking change for every module's auth middleware; requires coordinated rollout.

## Phase 1 scope

This Phase 1 port covers: role CRUD, user-role assignments, the event handler that rebuilds `AuthzView` on user/group events, plus the read-only `GET /user/me/permissions` endpoint.

Deferred to follow-up:
- Role hierarchy (`childRoleIds` inheritance resolution)
- Group-role assignments (needs s-group's group membership data first)
- Admin sync-all endpoint for bulk rebuild after role-schema migrations

## Scope-required permissions + per-assignment `value`

Some permissions carry a per-user scope (e.g. `building_admin` on buildings `[A, B]`). The mechanics:

- **Role template** — each `Permission` in the role's `permissions` array may or may not carry a `value` field:
  - `{ id: "X" }` (no field) → **global permission**. Consumers ignore scope. Assignment `value` is dropped.
  - `{ id: "X", value: [] }` (empty array marker) → **scope-required permission**. Assignment `value` flows through.
- **Assignment** (`AuthzUserRole`) carries an optional `value: unknown[]`. `POST /authz/admin/users/{userId}/roles/{roleId}` accepts body `{ value?: unknown[] }`. Re-assigning the same role to the same user **unions** the incoming `value` with the existing row's value — no 409. Each user can have at most 100 role assignments; creating a new assignment over that cap returns `400 VALIDATION_ERROR`, while reassigning an existing role at the cap is allowed. The stored unique assignment scope is capped at 500 entries and 65,536 serialized bytes; oversized values return `400 VALIDATION_ERROR`.
- **View rebuild** (`rebuildViewForUser` → `resolvePermissionsForAssignments`):
  - For each assignment, walk the role's permission template.
  - Scope-required permissions get `unique([...template.value, ...assignment.value])`.
  - Across multiple assignments that contribute the same permission id, values are unioned. If either side is global, the merged entry drops `value` entirely (most-permissive wins).

## System roles

System roles (`system: true`) can't be deleted via API. They're idempotently seeded by `modules/s-authz/`'s `AuthzSeeds` Lambda (run once per fresh stage — see [`docs/runbooks/fresh-stage-bootstrap.md`](../../docs/runbooks/fresh-stage-bootstrap.md)):

| Role | Template |
|---|---|
| `building-superadmin` | `[{ id: "building_superadmin" }]` (global) |
| `building-admin` | `[{ id: "building_admin", value: [] }]` (scope-required) |
| `building-manager` | `[{ id: "building_manager", value: [] }]` |
| `building-user` | `[{ id: "building_user", value: [] }]` |
| `user-superadmin` | `[{ id: "user_superadmin" }]` (global) |

Extend by appending to `packages/s-authz/core/src/seeds/system-roles.ts`'s `SYSTEM_ROLES` array. Redeploying + re-invoking `AuthzSeeds` picks up additions.
