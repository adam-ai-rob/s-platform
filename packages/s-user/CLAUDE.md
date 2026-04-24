# s-user — AI Agent Rules

User profile data: names, avatar, preferences, metadata. Profile records share the user ID with the `s-authn` identity record.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

**REST conventions:** see [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md). New endpoints MUST follow the v1 convention (plural `/users`, explicit `admin`/`user` audience). Legacy `/user/me`, `/user/{id}`, and `/user/search` routes are served only for the #73 deprecation window with `Deprecation` / `Sunset` headers.

## Bounded Context

**What s-user owns:**
- `UserProfile` (firstName, lastName, avatarUrl, preferences, metadata)
- Profile creation on `user.registered` event
- Profile CRUD API

**What s-user does NOT own:**
- Identity / credentials (s-authn)
- Permissions (s-authz)
- Group membership (s-group)

## DynamoDB Tables

| Table | PK | GSIs | Notes |
|---|---|---|---|
| `UserProfiles` | `userId` (= AuthnUser.id) | — | Streams enabled |

## Events

### Publishes (via DDB Streams)

| Event | Trigger |
|---|---|
| `user.profile.created` | INSERT on UserProfiles |
| `user.profile.updated` | MODIFY on UserProfiles |

### Subscribes (via EventBridge rule → event-handler Lambda)

| Event | Source | Side effect |
|---|---|---|
| `user.registered` | s-authn | Create empty UserProfile with matching userId |

## API Surface

- `GET /user/user/users/me` — caller's profile (authenticated)
- `PATCH /user/user/users/me` — update caller's profile
- `GET /user/admin/users/{id}` — any profile, requires `user_superadmin`
- `GET /user/admin/users` — Typesense-backed profile list/search, requires `user_superadmin`
- Deprecated for one release: `GET/PATCH /user/me`, `GET /user/{id}`, `GET /user/search`
- Plus platform-standard `/user/health`, `/info`, `/openapi.json`, `/docs`

## Permissions

| Permission | Scope | Purpose |
|---|---|---|
| `user_superadmin` | global | Full access to every user profile and the admin search surface |

## Change Rules

- Schema changes to `UserProfile` response require explicit approval.
- Subscribers to `user.profile.*` events are in other modules — additions/changes to emitted events need coordination.
- Breaking changes to the OpenAPI or AsyncAPI contracts are blocked in CI by `scripts/contract-diff.ts` — add the `breaking-api-change` label + migration plan to override.
