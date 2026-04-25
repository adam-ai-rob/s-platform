# s-user

User profile service. Owns profile data (firstName, lastName, avatar, preferences, metadata) keyed by the user's identity ULID from `s-authn`.

Part of the [s-platform](../../README.md) monorepo. See [`CLAUDE.md`](./CLAUDE.md) for agent rules, [`docs/architecture/09-api-conventions.md`](../../docs/architecture/09-api-conventions.md) for the REST rules this module follows, and the generated `/user/openapi.json` for the full HTTP contract.

## Bounded context

Owns the `UserProfile` aggregate: first name, last name, avatar URL, preferences, and metadata. Profile IDs match the owning `s-authn` identity ULID.

Profiles are not resource-scoped. A caller can manage their own profile through the user audience; cross-user reads and the admin list require the single global `user_superadmin` permission. There is no scoped admin tier because user profiles do not have a per-resource ownership boundary like buildings do.

## Permissions and roles

One permission is registered in s-authz and one matching system role is idempotently seeded by s-authz's `AuthzSeeds` Lambda on fresh-stage bootstrap.

| Role | Permission template | Scope |
|---|---|---|
| `user-superadmin` | `[{ id: "user_superadmin" }]` | global |

Access matrix enforced by this module's route layer:

| Endpoint | Superadmin | Self-only caller | Stranger |
|---|---|---|---|
| `GET /user/user/users/me` | own profile | own profile | n/a |
| `PATCH /user/user/users/me` | own profile | own profile | n/a |
| `GET /user/admin/users` | all profiles | 403 | 403 |
| `GET /user/admin/users/{id}` | any profile | 403 | 403 |

## Tables

- `UserProfiles` (PK `userId`, streams enabled)

## Events published

- `user.profile.created`, `user.profile.updated`

## Endpoints

User audience (`/user/user/*`):

- `GET /user/user/users/me` — caller's own profile
- `PATCH /user/user/users/me` — update caller's own profile

Admin audience (`/user/admin/*`):

- `GET /user/admin/users` — Typesense-backed list (requires `user_superadmin`)
- `GET /user/admin/users/{id}` — read any profile (requires `user_superadmin`)

Plus `/user/health`, `/info`, `/openapi.json`, `/docs`.

## Postman

[`docs/postman/user.postman_collection.json`](./docs/postman/user.postman_collection.json) ships every endpoint with variable-substituted `{{baseUrl}}`, `{{accessToken}}`, and `{{userId}}`. Pick a stage's base URL, paste a JWT obtained via `POST /authn/auth/login`, and use the user-audience requests for self-service or the admin-audience requests with a caller that has `user_superadmin`.

Common error paths:
- `401` — missing or invalid `Authorization: Bearer <jwt>` header.
- `403` — admin audience only: caller lacks `user_superadmin`.
- `404` — profile does not exist or has not been provisioned from the `user.registered` event yet.

## Deferred

- Avatar upload (S3 presigned URLs)
- Bulk operations
