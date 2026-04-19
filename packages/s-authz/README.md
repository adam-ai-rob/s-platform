# s-authz

Authorization service. Roles, user↔role assignments, and the materialized `AuthzView` that every other module's auth middleware reads to load a user's permissions.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules.

## Phase 1 scope

- Role CRUD
- User↔role assignments
- Event-driven rebuild of `AuthzView` on `user.registered`, `user.enabled`, `user.disabled`, `group.user.activated`, `group.user.deactivated`
- Read endpoint: `GET /authz/user/me/permissions`
