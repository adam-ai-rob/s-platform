# s-authz — AI Agent Rules

Authorization: roles, user-role and group-role assignments, materialized `AuthzView` per-user used by every other module's auth middleware.

Read [monorepo CLAUDE.md](../../CLAUDE.md) first.

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
- `GET /authz/admin/roles` — list roles (permission `authz_admin`)
- `POST /authz/admin/roles` — create role
- `GET /authz/admin/roles/{id}` — get role
- `DELETE /authz/admin/roles/{id}` — delete role
- `POST /authz/admin/users/{userId}/roles/{roleId}` — assign
- `DELETE /authz/admin/users/{userId}/roles/{roleId}` — unassign
- Plus platform-standard endpoints

## Change Rules

- Adding/removing permissions from the model requires a full `AuthzView` rebuild — document in the PR.
- Any change to how `AuthzView` is keyed/structured is a breaking change for every module's auth middleware; requires coordinated rollout.

## Phase 1 scope

This Phase 1 port covers: role CRUD, user-role assignments, the event handler that rebuilds `AuthzView` on user/group events, plus the read-only `GET /user/me/permissions` endpoint.

Deferred to follow-up:
- Role hierarchy (`childRoleIds` inheritance resolution)
- Group-role assignments (needs s-group's group membership data first)
- Admin sync-all endpoint for bulk rebuild after role-schema migrations
- Value-scoped permission aggregation across roles (currently just a flat union)
