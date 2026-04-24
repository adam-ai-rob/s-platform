# s-user

User profile service. Owns profile data (firstName, lastName, avatar, preferences, metadata) keyed by the user's identity ULID from `s-authn`.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules.

## Scope (Phase 1)

- Auto-create profile on `user.registered` from s-authn
- `GET /user/user/users/me` / `PATCH /user/user/users/me` for self-service
- `GET /user/admin/users/{id}` for cross-user reads (`user_superadmin`)
- `GET /user/admin/users` for Typesense-backed admin list/search (`user_superadmin`)
- Deprecated compatibility routes for one release: `/user/me`, `/user/{id}`, `/user/search`
- Streams emit `user.profile.created` / `user.profile.updated`

## Deferred

- Avatar upload (S3 presigned URLs)
- Bulk operations
