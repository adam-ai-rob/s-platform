# s-authz

Authorization service. Roles, user↔role assignments, and the materialized `AuthzView` that every other module's auth middleware reads to load a user's permissions.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules and the generated `/authz/openapi.json` contract for the complete HTTP schema.

## Phase 1 scope

- Role CRUD
- User↔role assignments
- Event-driven rebuild of `AuthzView` on `user.registered`, `user.enabled`, `user.disabled`, `group.user.activated`, `group.user.deactivated`
- Read endpoint: `GET /authz/user/me/permissions`

## Endpoints

User audience (`/authz/user/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `GET /authz/user/me/permissions` | bearer token | Returns `{ data: { userId, permissions } }`, the caller's effective materialized permission view. Scoped permissions include a `value` array. |

Admin audience (`/authz/admin/*`) requires `authz_admin`:

| Endpoint | Description |
|---|---|
| `POST /authz/admin/roles` | Creates a role from a unique name and permission templates. Returns `201` with `{ data: role }`, or `409` for a duplicate role name. |
| `GET /authz/admin/roles/{id}` | Returns one role by id, or `404` if it does not exist. |
| `DELETE /authz/admin/roles/{id}` | Deletes a non-system role. Returns `204`, `404` for a missing role, or `409` for a system role. |
| `POST /authz/admin/users/{userId}/roles/{roleId}` | Assigns a role to a user. Optional body `{ "value": [...] }` scopes assignments for scope-requiring permissions; reassigning unions new scope values with existing ones and returns `204`. Each user can have at most 100 role assignments. The stored unique scope is capped at 500 entries and 65,536 serialized bytes; invalid or oversized values return `400`. |
| `DELETE /authz/admin/users/{userId}/roles/{roleId}` | Removes a user-role assignment and returns `204`, or `404` when the assignment does not exist. |

Plus `/authz/health`, `/authz/info`, `/authz/openapi.json`, and `/authz/docs`.

## Postman

[`docs/postman/authz.postman_collection.json`](./docs/postman/authz.postman_collection.json) includes role, assignment, and caller-permission requests with `{{baseUrl}}`, `{{accessToken}}`, `{{roleId}}`, `{{userId}}`, and `{{scopeValue}}` variables.

Common error paths:
- `401` — missing or invalid `Authorization: Bearer <jwt>` header.
- `403` — admin audience only: caller lacks `authz_admin`.
- `400` — malformed request body, assignment count cap, or assignment scope cap exceeded.
- `404` — role or assignment not found.
- `409` — duplicate role name or attempted delete of a system role.
