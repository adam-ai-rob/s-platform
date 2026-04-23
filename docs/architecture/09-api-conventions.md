# API Conventions

Platform-wide REST conventions v1. Every module follows this document. Any endpoint that does not conform is a bug to be tracked as a retrofit.

**Mandatory reading** for any agent building a new module, an endpoint, or reviewing a PR that touches HTTP.

Companion ADR: [`adr/003-rest-api-conventions-v1.md`](./adr/003-rest-api-conventions-v1.md) — rationale and rejected alternatives.

## At a glance — the rules, in one page

1. **URL shape:** `/{module}/{audience}/{resources}[/{id}][:{action}]`
   - `module` singular (`building`, `user`, `authz`) — bounded context
   - `audience` is `admin` or `user` — platform reserves the caller-less root (`/health`, `/info`, `/openapi.json`, `/docs`)
   - `resources` **plural** (`buildings`, `roles`, `profiles`) — no singular item paths
   - `{id}` is opaque (we use UUIDs)
   - `:{action}` for custom verbs that don't fit CRUD (Google AIP-136): `POST /buildings/{id}:archive`
2. **Methods:** `GET` read, `POST` create or action, `PATCH` partial update, `DELETE` remove. **Never `PUT`.**
3. **Status codes:** 200 read/update, 201 create (with `Location:`), 202 async action, 204 delete / no-content action. Errors: 400/401/403/404/409/422/429/500/503.
4. **Lists:** `q`, `filter_by`, `sort_by`, `facet_by`, `page`, `per_page` (≤100), optional `cursor`. Fields **whitelisted server-side**. Syntax passes through to Typesense.
5. **Response envelope:**
   - single → `{ "data": {...} }`
   - list → `{ "data": [...], "meta": { "page", "perPage", "found", "outOf", "searchTimeMs", "nextCursor?", "facets?" } }`
   - error → `{ "error": { "code", "message", "details?" } }` in the 4xx/5xx body — **errors never travel with data**
   - 204 → empty body
6. **Headers:** `Authorization: Bearer` required; `Idempotency-Key` on POST create + `:action`; `If-Match`/`ETag` optional optimistic concurrency; `X-Request-Id`/`traceparent` propagated by platform.
7. **JSON:** camelCase field names; timestamps ISO 8601 UTC + paired `*Ms` int64 (`createdAt` + `createdAtMs`).
8. **No URL versioning.** Contracts are gated by `scripts/contract-diff.ts`; breaking changes require the `breaking-api-change` label + migration plan (see [root `CLAUDE.md`](../../CLAUDE.md)).

Everything below elaborates on these rules and shows the code patterns.

## 1. URL path shape

```
/{module}/{audience}/{resources}[/{id}][:{action}]
```

### Segments

| Segment | Rule |
|---|---|
| `module` | **Singular** noun of the bounded context. Current modules: `authn`, `authz`, `user`, `group`. New: `building`. Set via `basePath` in `createApi()`. |
| `audience` | One of `admin` \| `user`. Exactly one for every authenticated route. The caller-less root (`/health`, `/info`, `/openapi.json`, `/docs`) is platform-reserved — do not put business routes there. |
| `resources` | **Plural** noun. Always. `buildings`, not `building`. Even when the module name is the resource (e.g. `user`): `/user/user/users/{id}`, not `/user/user/{id}`. |
| `{id}` | Opaque string (UUIDs today). Path-id is the source of truth; if body carries an `id`, the path wins. |
| `:{action}` | Google AIP-136 custom action. Colon (not slash) so routers can distinguish a sub-resource from a verb. Reserved for things that don't fit CRUD — rare but legitimate (archive, activate, sendTestEmail). |

### Worked example for s-building

| Purpose | Method + path |
|---|---|
| Create | `POST   /building/admin/buildings` |
| List (admin) | `GET    /building/admin/buildings?q=…&filter_by=…&sort_by=…&page=…&per_page=…` |
| Get | `GET    /building/admin/buildings/{id}` |
| Update | `PATCH  /building/admin/buildings/{id}` |
| Archive | `POST   /building/admin/buildings/{id}:archive` |
| Activate | `POST   /building/admin/buildings/{id}:activate` |
| Delete | `DELETE /building/admin/buildings/{id}` |
| List mine | `GET    /building/user/buildings` |
| Get mine | `GET    /building/user/buildings/{id}` |

### Caller-centric `/me` alias

`/me` is allowed as a stand-in for `{id}` in the `user` audience only. `GET /user/user/users/me` is equivalent to `GET /user/user/users/{callerId}` — helpful on consumer clients that don't want to thread a user id through every call.

### Sub-resources

When a resource has children, nest by plural name: `GET /building/admin/buildings/{id}/floors`. Recursively applies the same rules to each level.

### Inherited inconsistencies (tracked for retrofit)

Modules built before this convention may not yet conform. They remain valid but are **flagged for retrofit** in [#73](https://github.com/adam-ai-rob/s-platform/issues/73):

- **s-user path shape** — `GET /user/me`, `PATCH /user/me`, `GET /user/{id}` are singular. v1 requires `/user/user/users/me` and `/user/admin/users/{id}`.
- **s-user search envelope + casing** — `GET /user/search` returns a flat `{ hits, page, per_page, found, out_of, search_time_ms, next_cursor }` with **snake_case** keys and **no `data` wrapper**. v1 requires `{ data, meta: { page, perPage, found, outOf, searchTimeMs, nextCursor? } }` with camelCase.
- **s-authn user routes** — `POST /authn/user/me/logout`, `PATCH /authn/user/me/password` are singular. Retrofit to the v1 shape (`POST /authn/user/sessions:revoke` and `PATCH /authn/user/users/me/password`, or similar — exact form decided in the retrofit PR).
- **List envelope** — existing list endpoints (and the shared `ListResponse` schema helper in [`packages/shared/src/types/index.ts`](../../packages/shared/src/types/index.ts)) return `{ data, metadata: { nextToken } }`. v1 mandates `{ data, meta: { page, perPage, found, outOf, searchTimeMs, nextCursor?, facets? } }`. The shared helper + every consumer must rename in lockstep.

New code MUST use the v1 shape. Existing non-conforming endpoints stay until the retrofit PR — which will keep the old paths/envelope for one release behind `Deprecation:` + `Sunset:` headers.

> **Why `/user/user/users/{id}` looks triple-redundant and still correct:** the first segment is the **module** (`s-user` → basePath `/user`), the second is the **audience** (`user` vs `admin`), the third is the **resource** (`users`, plural). Each segment earns its place; modules where the bounded context name happens to match the primary resource pay a small cosmetic cost in exchange for a uniform URL grammar platform-wide.

## 2. HTTP methods + status codes

| Method | Use | Success | Body on success |
|---|---|---|---|
| `GET` | Read | `200 OK` | single resource or list envelope |
| `POST` (create) | Create resource in a collection | `201 Created` + `Location: /.../{id}` header | the created resource (`{ data }`) |
| `POST` (action) | Custom action `:verb` | `200 OK`, or `202 Accepted` for async | resource, or `{ data: { jobId } }` for async |
| `PATCH` | Partial update. RFC 7396 merge-patch semantics — `BaseRepository` maps `null`/`""`/`[]` → DynamoDB REMOVE. | `200 OK` | the updated resource |
| `PUT` | **Forbidden.** The platform does not use full-replace updates. |   |   |
| `DELETE` | Remove | `204 No Content` | empty |

Status codes for errors: `400` validation (zod-openapi auto-emits), `401` missing/bad token, `403` authenticated but not authorised, `404` not found **or deliberately hidden**, `409` state conflict (e.g. `draft → archived` rejected), `412` precondition failed (If-Match mismatch), `422` semantic validation (rare), `429` rate-limited, `500` server, `503` downstream unavailable.

**Hiding vs forbidding.** When a resource exists but the caller isn't supposed to know, return `404` instead of `403` (consumer `/user` audience hides non-active and non-scoped buildings this way). Do not leak existence.

## 3. Request conventions

### Path parameters — `{id}` syntax

Per OpenAPI, use `{id}` not `:id`:

```ts
path: "/buildings/{id}",     // ✅
path: "/buildings/:id",      // ❌
```

### Query parameters

Coerced + validated via zod-openapi in `createRoute.request.query`:

```ts
const ListQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  facet_by: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
```

Rejects unknown query keys that aren't in the schema — strict.

### Body validation

Request body is JSON only. Content-Type must be `application/json`. zod-openapi rejects anything else.

### Request size

- Request body ≤ 10 MB (API Gateway hard limit)
- Response body ≤ 10 MB
- For larger payloads use S3 presigned URLs (not implemented yet; add per-module on demand).

## 4. List querying + filter DSL

Any list endpoint backed by Typesense MUST accept this exact query envelope:

| Param | Purpose | Default | Cap |
|---|---|---|---|
| `q` | Full-text query (Typesense `q`). `*` means match-all. | `*` | — |
| `filter_by` | Typesense filter expression. **Only fields in the module's `FILTER_FIELDS` whitelist.** Server returns `400` on unknown fields. | — | — |
| `sort_by` | `field:asc|desc[,field:asc|desc]`. Only fields in `SORT_FIELDS`. Must include a unique tiebreaker (`id`) when `cursor` is used. | `createdAtMs:desc` | — |
| `facet_by` | Facet fields (whitelisted). Module-specific default. | module default | — |
| `page` | Page number (1-based). | `1` | — |
| `per_page` | Page size. | `20` | `100` |
| `cursor` | Opaque keyset cursor. When set, overrides `page`. | — | — |

### Why pass Typesense syntax through

- Builds on [#59](https://github.com/adam-ai-rob/s-platform/issues/59), which shipped `q`, `filter_by`, `sort_by`, `page`, `per_page`, `cursor` on `GET /user/search`. v1 standardises those across every list endpoint and **adds `facet_by`** (not shipped in #59) as part of the canonical envelope. The `SORT_FIELDS` / `FILTER_FIELDS` whitelist pattern also originates from #59.
- Covers boolean, range, `IN`, negation — enough for every list endpoint we have.
- Field whitelist neutralises the injection risk; same approach Algolia + Typesense recommend.

See [ADR 003](./adr/003-rest-api-conventions-v1.md) for alternatives considered (JSON:API `filter[x]=y`, RSQL/FIQL, Django `foo__gte=`) and why each was rejected.

### Pagination — page vs cursor

- **page + per_page** is the default (UI-friendly, REST-conventional, round-trippable).
- **cursor** is opt-in for deep pagination, exports, and background jobs. Encodes `(lastSortValues, lastId)` in opaque base64. Resume-safe under concurrent writes.
- Both can be implemented from the same underlying search — see `packages/s-user/core/src/search/users.search.ts`.

### Example

```
GET /building/admin/buildings
  ?q=*
  &filter_by=status:=active && countryCode:=CZ
  &sort_by=population:desc,id:desc
  &facet_by=status,countryCode
  &page=1
  &per_page=20
```

## 5. Response envelope

### Single resource (200 / 201)

```json
{
  "data": {
    "id": "01HXYZ...",
    "name": "Karlín Tower",
    "createdAt": "2026-04-17T10:30:00.000Z"
  }
}
```

### List (200)

```json
{
  "data": [
    { "id": "01HABC...", "name": "A" },
    { "id": "01HDEF...", "name": "B" }
  ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "found": 847,
    "outOf": 1203,
    "searchTimeMs": 3,
    "nextCursor": "eyJsYXN0Ijp7ImNy…",
    "facets": [
      { "field": "status", "counts": [ { "value": "active", "count": 128 } ] }
    ]
  }
}
```

- `found` — total matching documents
- `outOf` — total indexable documents (pre-filter)
- `nextCursor` — present only if more results exist
- `facets` — present only when `facet_by` was requested

### 204 No Content

Empty body. Used by `DELETE` and action endpoints that don't return data.

### 202 Accepted (async)

```json
{ "data": { "jobId": "..." } }
```

Used only for actions that can't complete synchronously (e.g. triggering a large rebuild).

### Error (4xx / 5xx)

Produced by the global error handler in `@s/shared/errors`:

```json
{
  "error": {
    "code": "BuildingNotFound",
    "message": "Building 01HXYZ... not found",
    "details": { "buildingId": "01HXYZ..." }
  }
}
```

**Rules:**

- `code` — a stable string (PascalCase) that clients can match against
- `message` — human-readable; safe to display
- `details` — optional object; never a string, never sensitive data
- **Errors never travel with data.** `{ data, errors: [...] }` in a 200 response (JSON:API style) is rejected — it forces clients to inspect two things for failure and muddies HTTP status. Platform uses `DomainError` → handler → 4xx.

### Batch endpoints

Per-item failures only appear on true batch endpoints (none shipped today):

```json
{
  "data": [ { "id": "A", "ok": true }, { "id": "B", "ok": true } ],
  "meta": { "processed": 3 },
  "errors": [ { "index": 2, "code": "Forbidden", "message": "…" } ]
}
```

Document per batch endpoint.

### Field conventions

- **camelCase** for all JSON field names (no snake_case, no kebab-case).
- **Timestamps** — ISO 8601 UTC (`createdAt: "2026-04-17T10:30:00.000Z"`) **paired with** an int64 `*Ms` epoch (`createdAtMs: 1745052600000`) when the field is sortable/filterable in Typesense. Clients read ISO; search reads `*Ms`.
- **IDs** — opaque strings. UUIDs today.
- **Enums** — lowercase kebab-case or single-word (`active`, `draft`, `archived`). Never mixed with free text.
- **Money** — `{ amount: number, currency: "USD" }`. `amount` is in minor units (cents). Never floats.

## 6. Cross-cutting headers

| Header | Direction | Use |
|---|---|---|
| `Authorization: Bearer <jwt>` | Request | Required on every `admin`/`user` route. |
| `Idempotency-Key: <uuid>` | Request | Required on `POST` create + `:action` endpoints. Server stores key → response hash for N minutes. Deferred implementation — document the hook; current endpoints SHOULD accept the header but may ignore it. |
| `If-Match: <etag>` | Request | Optional on `PATCH` / `DELETE` for optimistic concurrency. Server returns `412 Precondition Failed` on mismatch. Deferred. |
| `ETag: <etag>` | Response | Returned on single-item `GET` once `If-Match` is implemented. Deferred. |
| `Location: /...` | Response | Required on `201 Created`. Points at the newly created resource. |
| `X-Request-Id` | Both | Correlation id — gateway generates if absent; modules propagate via `@s/shared/trace`. |
| `traceparent` | Both | W3C trace context — propagated by `@s/shared/trace`. |
| `Sunset`, `Deprecation` | Response | Used during deprecation windows. See §10. |

## 7. No URL versioning

The platform does **not** use `/v1/...` / `/v2/...`. Reasoning:

- Contracts are gated by `scripts/contract-diff.ts` on every PR. Breaking changes require the `breaking-api-change` label + migration plan.
- CalVer releases (`vYYYY.MM.N`) track the whole platform — per-endpoint versioning duplicates that.
- Major redesigns ship behind feature flags or under a new resource path; the caller opts in.

This matches Microsoft's position that URL versioning is a last resort. See ADR 003.

## 8. OpenAPIHono patterns

### Factory — do not hand-roll the mandatory endpoints

Every module uses `createApi()` from `@s/shared/http`. It provisions `/health`, `/info`, `/openapi.json`, `/docs`, CORS, trace middleware, and the global error handler:

```ts
// packages/s-building/functions/src/api.ts
import { createApi } from "@s/shared/http";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";

const app = createApi<AppEnv>({
  service: "s-building",
  title: "s-building — Buildings Service",
  description: "Buildings: CRUD + scoped-permission lists.",
  version: "1.0.0",
  basePath: "/building",
  permissions: {
    building_superadmin: "Full access to all buildings",
    building_admin: "Admin on buildings in value scope",
    building_manager: "Manager on buildings in value scope (no delete)",
    building_user: "Read active buildings in value scope",
  },
  events: {
    publishes: [
      "building.created", "building.updated",
      "building.activated", "building.archived", "building.deleted",
    ],
    subscribes: [],
  },
  topics: { "building-events": "Building lifecycle" },
});

app.route("/admin", adminRoutes);
app.route("/user", userRoutes);

export default app;
```

### `createRoute` with Zod schemas

Typed route definitions emit OpenAPI automatically. Validation is built in — no `zValidator` middleware.

```ts
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const CreateBuildingBody = z.object({
  name: z.string().min(1).max(200),
  /* … */
});

const BuildingResponse = z.object({
  data: z.object({ /* … */ }),
});

const createBuildingRoute = createRoute({
  method: "post",
  path: "/buildings",
  tags: ["Building Admin"],
  security: [{ Bearer: [] }],
  request: {
    headers: z.object({ "idempotency-key": z.string().uuid().optional() }),
    body: { content: { "application/json": { schema: CreateBuildingBody } }, required: true },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: BuildingResponse } } },
    400: { description: "Validation" },
    403: { description: "Forbidden" },
  },
});

admin.openapi(createBuildingRoute, async (c) => {
  const body = c.req.valid("json");
  const created = await createBuilding(body);
  c.header("Location", `/building/admin/buildings/${created.id}`);
  return c.json({ data: created }, 201);
});
```

### Route split

Each module mounts exactly two audience sub-routers:

```ts
app.route("/admin", adminRoutes);
app.route("/user",  userRoutes);
```

Inside each, use plural resource paths (`/buildings/{id}` etc.).

### Lambda handler

```ts
// packages/s-{module}/functions/src/handler.ts
import { handle } from "@hono/aws-lambda";
import app from "./api";
export const handler = handle(app);
```

## 9. CORS — do not change

API Gateway CORS is configured platform-wide. Current policy in [`platform/infra/gateway.ts`](../../platform/infra/gateway.ts):

```ts
cors: {
  allowOrigins: ["*"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Traceparent", "X-Location"],
}
```

(`credentials: false` is implicit — SST defaults to false, which is required for wildcard origin.)

Why wildcard:

- Auth is JWT bearer tokens in `Authorization` header — not cookies.
- `credentials: false` is required for wildcard `allowOrigins: ["*"]`.
- No security risk — bearer token must be present for protected routes.

### Header allowlist — current vs v1

| Header | In gateway today | Required by v1 | Notes |
|---|---|---|---|
| `Content-Type` | ✅ | ✅ | |
| `Authorization` | ✅ | ✅ | |
| `Traceparent` | ✅ | ✅ | W3C trace context |
| `X-Location` | ✅ | (keep) | Legacy, still in use — leave in place |
| `Idempotency-Key` | ❌ | when implemented | Gateway update required **in the same PR that turns on idempotency** (see §6). Until then the header is accepted by permissive browsers on same-origin calls but will be stripped cross-origin. |
| `If-Match` | ❌ | when implemented | Same — ship optimistic concurrency and the gateway update together. |
| `X-Request-Id` | ❌ | when implemented | Gateway generates if absent; the issue is only whether cross-origin clients can *send* one. Opt-in. |

**Do not change CORS without coordinating** — every deployed stage inherits from the platform app. Reviewers: do not flag wildcard.

## 10. Rate limiting

DynamoDB-backed sliding-window counters in a shared `RateLimits` table (in `@s/shared`). Lambda checks the counter, increments, and compares against the limit.

Response on limit exceeded:

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1700000060

{
  "error": {
    "code": "RateLimitExceeded",
    "message": "Too many requests. Please try again later."
  }
}
```

Default limits (per IP):

| Endpoint | Window | Max |
|---|---|---|
| `POST /authn/auth/login` | 1 min | 10 |
| `POST /authn/auth/register` | 1 min | 5 |
| `POST /authn/auth/token/refresh` | 1 min | 20 |
| `POST /authn/auth/password/reset` | 1 min | 3 |

IP from the `x-forwarded-for` header (API Gateway sets this). Rate limiter available as middleware from `@s/shared`.

## 11. Deprecation + contract changes

### Additive changes (safe)

- New endpoint
- New optional request field
- New response field
- Widened enum
- New query param with a default

These pass `scripts/contract-diff.ts` without a label. Note them in the PR description.

### Breaking changes (label required)

- Removed endpoint
- Renamed or removed response field
- Narrowed type
- Made a required field optional (or vice versa)
- Removed enum value

Attach the `breaking-api-change` label to the PR. **Include a migration plan in the PR description** (e.g. "both `email` and `emailAddress` emitted for two releases; `email` removed in v2026.08"). Reviewers MUST flag any response schema change.

### Deprecation window

When removing an endpoint or field:

1. Emit both old + new for one release cycle.
2. Set `Sunset: <http-date>` and `Deprecation: true` on the old endpoint's responses.
3. Remove in the next release. Update `RELEASE_NOTES.md` under `## Unreleased` with a `**Breaking**` line.

## 12. Postman collection

Each module maintains `packages/s-{module}/docs/postman/{Module}.postman_collection.json`. Updated in the **same PR** as any endpoint change. Reviewers verify Postman is current.

Generated from `/openapi.json` via `openapi-to-postman` (scripted in `packages/s-{module}/scripts/update-postman.sh`).

## 13. Release notes

Every PR updates `RELEASE_NOTES.md` under `## Unreleased`:

```markdown
## Unreleased

### Changes
- **Feature**: Add archive action to s-building admin API (PR #…)
- **Fix**: Correct 404-vs-403 leak on user audience (PR #…)
- **Breaking**: Rename list envelope `metadata` → `meta` (PR #…)
```

On release cut (merge to `stage/prod`): rename to `## v2026.MM.N — YYYY-MM-DD`, add fresh `## Unreleased`, tag.

## 14. Quick reference — checklist when adding an endpoint

- [ ] Path follows `/{module}/{audience}/{resources}[/{id}][:{action}]` with plural resources
- [ ] Correct method + status code (no PUT, 201 on create with `Location:`, 204 on delete)
- [ ] Permission gate via `requirePermission(…)` or a controller-layer value-scoped check
- [ ] `zod-openapi` schema for request body, params, query (with sensible defaults + caps)
- [ ] Response envelope: `{ data }` or `{ data, meta }`; errors via `DomainError` subclasses
- [ ] New Zod schemas registered; `/openapi.json` regenerated; `contract-diff` passes
- [ ] Postman collection updated in the same PR
- [ ] `RELEASE_NOTES.md` under `## Unreleased` updated
- [ ] If breaking: `breaking-api-change` label + migration plan in PR description
- [ ] Tests: unit (schema + service), integration (status codes + permission), and journey where flow spans modules
