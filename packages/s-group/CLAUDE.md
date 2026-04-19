# s-group — AI Agent Rules

Groups (company / team / building) and user memberships.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

## Bounded Context

**Owns:** groups, memberships, domain-based auto-assignment, invitation/approval state.

**Does NOT own:** roles or permissions (s-authz), user identity (s-authn), profiles (s-user).

## DynamoDB Tables

| Table | PK | GSIs | Notes |
|---|---|---|---|
| `Groups` | `id` | `ByName` | Group definitions |
| `GroupUsers` | `id` (composite `groupId#userId#rel`) | `ByGroupId`, `ByUserId` | Membership records |

## Events

### Publishes

- `group.created`, `group.updated`, `group.deleted` (Groups stream)
- `group.user.activated`, `group.user.deactivated` (GroupUsers stream)

### Subscribes

- `user.registered` — check email domain → auto-add to matching groups with `rel: "domain"`

## API Surface (Phase 1)

- `GET /group/user/me/groups` — list caller's groups
- `POST /group/admin/groups` — create
- `GET /group/admin/groups/{id}`, `DELETE /group/admin/groups/{id}`
- `POST /group/admin/groups/{id}/users/{userId}` — add
- `DELETE /group/admin/groups/{id}/users/{userId}` — remove

Plus platform-standard endpoints.

## Phase 1 scope

Direct CRUD + membership + simple domain matching. Deferred:

- Approval flows (user-approval, group-approval, invitation expiry scheduler)
- Child group hierarchy cascade
- Master owner auto-assignment
- Admin search / pagination with filters
