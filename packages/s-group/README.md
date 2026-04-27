# s-group

Groups and memberships. Publishes `group.user.activated` / `group.user.deactivated` events that drive `s-authz` to rebuild `AuthzView`.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules and the generated `/group/openapi.json` contract for the complete HTTP schema.

## Phase 1 scope

- Group CRUD (`Groups` table, `ByName` GSI)
- Membership records (`GroupUsers` table, `ByGroupId` / `ByUserId` GSIs)
- Domain-based auto-assignment on `user.registered`
- Activate/deactivate membership API

## Endpoints

User audience (`/group/user/*`):

| Endpoint | Auth | Description |
|---|---|---|
| `GET /group/user/me/groups` | bearer token | Returns `{ data: memberships }` for the authenticated caller's active group memberships. |

Admin audience (`/group/admin/*`) requires `group_admin`:

| Endpoint | Description |
|---|---|
| `POST /group/admin/groups` | Creates a group with a unique name and optional email-domain auto-assignment configuration. Returns `201` with `{ data: group }`, or `409` for a duplicate group name. |
| `GET /group/admin/groups/{id}` | Returns one group by id, or `404` if it does not exist. |
| `DELETE /group/admin/groups/{id}` | Deletes a group by id and returns `204`, or `404` if the group does not exist. |
| `POST /group/admin/groups/{id}/users/{userId}` | Creates a manual membership for the user in the group. Returns `204`, `404` when the group is missing, or `409` when the manual membership already exists. |
| `DELETE /group/admin/groups/{id}/users/{userId}` | Removes a manual membership and returns `204`, or `404` when the membership does not exist. |

Plus `/group/health`, `/group/info`, `/group/openapi.json`, and `/group/docs`.

## Postman

[`docs/postman/group.postman_collection.json`](./docs/postman/group.postman_collection.json) includes group and membership requests with `{{baseUrl}}`, `{{accessToken}}`, `{{groupId}}`, and `{{userId}}` variables.

Common error paths:
- `401` — missing or invalid `Authorization: Bearer <jwt>` header.
- `403` — admin audience only: caller lacks `group_admin`.
- `404` — group or manual membership not found.
- `409` — duplicate group name or existing manual membership.
