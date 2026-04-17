# s-user

User profile service. Owns profile data (firstName, lastName, avatar, preferences, metadata) keyed by the user's identity ULID from `s-authn`.

See [`CLAUDE.md`](./CLAUDE.md) for agent rules.

## Scope (Phase 1)

- Auto-create profile on `user.registered` from s-authn
- `GET /user/me` / `PATCH /user/me` for self-service
- `GET /user/{id}` for cross-user reads (authenticated)
- Streams emit `user.profile.created` / `user.profile.updated`

## Deferred

- Avatar upload (S3 presigned URLs)
- Admin list/search/filter (`/admin/users` pagination, `?query=` search)
- Bulk operations
