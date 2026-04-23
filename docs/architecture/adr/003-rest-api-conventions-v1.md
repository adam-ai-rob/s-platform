# ADR 003 — REST API Conventions v1

**Status:** Accepted. Realized via [#63](https://github.com/adam-ai-rob/s-platform/issues/63). Companion to the plan for s-building ([#62](https://github.com/adam-ai-rob/s-platform/issues/62)) which is the first module built on these conventions.

## Context

The platform shipped `s-authn`, `s-authz`, `s-user`, and `s-group` before a shared REST convention was codified. The result is inconsistency that's not fatal but is painful enough to fix before adding a fifth module:

- **Path shape:** `s-user` uses singular paths (`/user/me`, `/user/{id}`); `s-authz` uses plural collections (`/authz/admin/roles/{id}`). No rule for an admin/user audience split.
- **Response envelope:** list endpoints return `{ data, metadata }` with only `nextToken`. The richer shape needed by Typesense list endpoints (`found`, `outOf`, `searchTimeMs`, `facets`, keyset cursor) was never standardised.
- **Filter DSL:** [#59](https://github.com/adam-ai-rob/s-platform/issues/59) introduced Typesense passthrough (`q`, `filter_by`, `sort_by`, …) for `s-user`'s search endpoint, but there was no platform document making this canonical.
- **Custom actions:** no convention for verbs that don't fit CRUD (archive, activate, resend). Each module would otherwise invent its own.
- **Headers, versioning, casing, timestamp formats:** implicit, consistent in practice but not codified.

The first building module ([#62](https://github.com/adam-ai-rob/s-platform/issues/62)) is resource-scoped with `/admin` + `/user` audiences — a natural moment to land the convention before more code entrenches the status quo.

## Decision

Adopt the v1 REST conventions in [`09-api-conventions.md`](../09-api-conventions.md). The load-bearing rules:

1. **URL shape** — `/{module}/{audience}/{resources}[/{id}][:{action}]`. Singular module, `admin`/`user` audience, plural resources, Google AIP-136 `:action` for custom verbs.
2. **Methods + statuses** — `GET/POST/PATCH/DELETE` only (no `PUT`). 201 on create with `Location:`, 204 on delete, 404 for "hidden or missing" to avoid leaking existence.
3. **List queries** — Typesense passthrough (`q`, `filter_by`, `sort_by`, `facet_by`, `page`, `per_page` ≤ 100, optional `cursor`) with server-side field whitelists.
4. **Response envelope** — `{ data }` for single, `{ data, meta }` for list, `{ error: { code, message, details? } }` on 4xx/5xx. Errors never travel in 200 bodies.
5. **Headers** — `Authorization`, `Idempotency-Key`, `If-Match`/`ETag`, `X-Request-Id`/`traceparent`.
6. **JSON shape** — camelCase, ISO 8601 UTC timestamps paired with `*Ms` int64 epochs for Typesense sort.
7. **No URL versioning.** Contract-diff CI + `breaking-api-change` label + CalVer handle drift.

## Alternatives considered

### Filter DSL

| Alternative | Why rejected |
|---|---|
| **JSON:API `filter[field]=value`** | Too limited for `IN`, ranges, negation. Forces server-side parsing anyway; no gain over Typesense syntax. |
| **RSQL / FIQL** (`filter=status==active;createdAt=gt=…`) | Third-party parser, extra surface. Over-engineered for our needs. |
| **Django-style suffixes** (`createdAt__gte=…`) | Non-standard. Explodes the query-param key space. Awkward for nested conditions. |
| **Bespoke platform DSL** | We'd own the parser forever. No net win over Typesense passthrough + whitelist. |

Chose **Typesense passthrough + `FILTER_FIELDS` whitelist** because [#59](https://github.com/adam-ai-rob/s-platform/issues/59) already ships it, the whitelist neutralises injection risk, and Typesense is expressive enough for every list we've modelled.

### Response envelope

| Alternative | Why rejected |
|---|---|
| **JSON:API** `{ data, errors, meta, links, included }` | Too verbose; `links`/`included` solve problems we don't have. Mixing `data` + `errors` in a 200 muddles HTTP status. |
| **GitHub-style — raw array for lists + `Link:` header** | Loses structured pagination metadata; harder to document in OpenAPI. |
| **Microsoft `{ value, @odata.nextLink }`** | OData-flavoured; naming doesn't fit a non-OData stack. |
| **Stripe `{ data, has_more, url, object: "list" }`** | Close to what we want, but `object: "list"` is Stripe-specific taxonomy and `has_more` is strictly less useful than `found`/`outOf`. |
| **Keep existing `{ data, metadata }` envelope** | `metadata` doesn't match JSON:API's `meta`, and the shape is too thin for Typesense lists (missing `found`, `outOf`, `searchTimeMs`, `facets`, keyset `nextCursor`). |

Chose a shape that **extends** the platform's existing `{ data }` envelope, renames `metadata` → `meta` (JSON:API convention), and adds the Typesense-native fields needed for real lists. Existing list endpoints are non-conforming and tracked in the retrofit ([#73](https://github.com/adam-ai-rob/s-platform/issues/73)).

### Pagination

| Alternative | Why rejected |
|---|---|
| **Offset/limit only** | Drifts under concurrent writes at depth; query plans degrade. |
| **Cursor only** | Not UI-friendly for simple paginated tables. |
| **Link-header pagination** | Harder to document in OpenAPI; less ergonomic for SDK generation. |

Chose **page + per_page as default, opt-in cursor for deep pagination**. Same path [#59](https://github.com/adam-ai-rob/s-platform/issues/59) already uses.

### URL versioning

Considered `/{module}/v1/...` + major-version bumps. Rejected:

- Duplicates the CalVer release line (`vYYYY.MM.N`) already in place.
- `scripts/contract-diff.ts` + `breaking-api-change` label already gate breaking changes with a per-PR migration plan.
- Major redesigns can ship under a new resource path or behind feature flags — no need for a version prefix on every call.
- Matches the Microsoft REST API Guidelines position that URL versioning is a last resort.

### Custom actions (`:verb`)

Considered alternatives:

- **Sub-resource POST** (`POST /buildings/{id}/archive`) — conflicts with "can we ever have a child resource named `archive`?". The colon unambiguously says "verb".
- **Method override** (`POST /buildings/{id}` with `X-Action: archive`) — hides intent from the URL; breaks OpenAPI and caching.
- **PATCH with `{ status: "archived" }`** — conflates two intents (update a field vs trigger a state transition with side effects like event publication). State transitions are explicit verbs.

Chose **Google AIP-136 `:verb`** — explicit, self-documenting, supported by OpenAPI via normal POST path.

### Audience split

Considered alternatives:

- **Permission-only gating without audience prefix** — loses the clear signal that "this endpoint is for consumer apps" vs "this is for admin apps". Makes CORS and rate-limit policy harder to target.
- **Separate gateways per audience** — infrastructure cost + complexity with no user-visible gain.

Chose `/admin` + `/user` prefixes because they map 1:1 to the client apps we build (admin dashboard vs consumer PWA/native), and make permission gates obvious in code review.

## Consequences

### Positive

- New modules (starting with s-building in [#62](https://github.com/adam-ai-rob/s-platform/issues/62)) ship with a single, unambiguous specification.
- Review cost drops — reviewers check conformance, not invent-as-you-go rules.
- OpenAPI spec + generated clients are uniform across modules.
- Typesense-backed lists have a richer envelope that UIs can actually use (total counts, facets, search time, deep-paginate cursor).

### Negative / migration cost

Full non-conforming inventory — all folded into [#73](https://github.com/adam-ai-rob/s-platform/issues/73) as a single `breaking-api-change` retrofit:

- **s-user path shape** — `GET /user/me`, `PATCH /user/me`, `GET /user/{id}` are singular. v1 requires plural collections under an explicit audience.
- **s-user `GET /user/search`** — returns a flat `{ hits, page, per_page, found, out_of, search_time_ms, next_cursor }` with **snake_case** keys and no `data` wrapper. v1 requires `{ data, meta: { … } }` with camelCase.
- **s-authn `/user/me/*` routes** — `POST /authn/user/me/logout` and `PATCH /authn/user/me/password` use the same legacy shape.
- **`@s/shared/types` `ListResponse` helper** — returns `{ data, metadata: { nextToken } }`; v1 mandates `{ data, meta: { page, perPage, found, outOf, searchTimeMs, nextCursor?, facets? } }`. The helper + every consumer rename in lockstep.

During the deprecation window both shapes are served on the same endpoints; `Sunset:` / `Deprecation:` headers signal clients. The `ListResponse` shim emits both `metadata` (legacy) and `meta` (v1) fields for one release so consumers can migrate independently. Removal lands in the next release.

### Neutral

- Existing mandatory endpoints (`/health`, `/info`, `/openapi.json`, `/docs`) and CORS/rate-limit policy are unchanged — already consistent.

## Compliance + enforcement

- [`docs/architecture/09-api-conventions.md`](../09-api-conventions.md) is the authoritative document. The root `CLAUDE.md` and every module `CLAUDE.md` link to it.
- `scripts/contract-diff.ts` catches breaking changes automatically; the `breaking-api-change` label overrides with a migration plan.
- PR reviewers (human or agent) verify new endpoints against the §14 checklist in the conventions doc.
- When we discover a non-conforming endpoint, we file a `tech-debt` issue (e.g. [#73](https://github.com/adam-ai-rob/s-platform/issues/73)) — we don't touch it mid-stream in an unrelated PR.

## References

- [`docs/architecture/09-api-conventions.md`](../09-api-conventions.md) — v1 specification
- Google API Design Guide, AIP-136 (custom methods), AIP-121 (resource-oriented design)
- Microsoft REST API Guidelines
- Zalando RESTful API Guidelines
- JSON:API v1.1 specification
- [#59](https://github.com/adam-ai-rob/s-platform/issues/59) — Typesense integration (filter DSL precedent)
- [#62](https://github.com/adam-ai-rob/s-platform/issues/62) — s-building epic (first module on v1)
- [#73](https://github.com/adam-ai-rob/s-platform/issues/73) — s-user retrofit (breaking)
