# ADR 002 — Search: Shared Typesense Cluster, Stage-Prefixed Collections

**Status:** Accepted. Realized in
[#59](https://github.com/adam-ai-rob/s-platform/issues/59) —
`feat/typesense-integration`.

## Context

The platform needs Linear-style list UX on entity collections (`users`
first, others to follow): full-text search, filter, sort, facets,
sub-second update visibility, and predictable cost.

Engines evaluated (summarised — full write-up lives in issue #59):

- **OpenSearch Serverless** — rejected. Non-configurable ~10s refresh
  ceiling rules out the "create → appear in list" UX.
- **OpenSearch Service (provisioned)** — viable but heavy ops, JVM
  footprint 2–3× Typesense at comparable scale, and over-features the
  actual need.
- **Algolia** — search-volume pricing scales poorly and vendor lock-in
  is deeper than we want at the platform tier.
- **Meilisearch** — strong, but multi-region replication is Enterprise-
  only until the serverless indexes roadmap lands (Q3 2026).
- **Typesense** — single-binary, C++, sub-second indexing, scoped API
  keys, dedicated Cloud cluster with Search Delivery Network for
  eventual US+EU replication. Picked for simplicity and cost shape.

## Decision

1. **Single Typesense Cloud cluster serves every stage** — `dev`,
   `test`, personal stages, and `prod`. Early-stage cost optimization;
   isolation guarantees are logical, not physical. (Per-PR `pr-{N}`
   stages were retired in #55 — PR verification now happens via the
   `deployed-test` label which deploys to the shared `dev` stage, not
   to an ephemeral stage; search inherits that model.)

2. **Logical isolation via stage-prefixed collection names.** Every
   collection is `{stage}_{entity}` — `dev_users`, `prod_users`,
   `robert_users`. Module code derives the prefix exclusively from
   `process.env.STAGE` via
   [`resolveCollectionName()`](../../../packages/shared/src/search/collections.ts).
   There is no supported path for code to construct a collection name
   any other way.

3. **Enforcement via scoped API keys.** Each stage gets two keys,
   stored as SSM `SecureString` parameters:
   - `api-key-admin` — `collections: {stage}_.*`, full write + schema
   - `api-key-search` — `collections: {stage}_.*`, `documents:search` only

   Typesense treats the `collections` field on scoped keys as a **regex**,
   not a glob — `{stage}_.*` (not `{stage}_*`) is what actually matches
   every collection starting with `{stage}_`. A glob-style `*` value
   silently produces a key that 401s every authenticated call.

   Typesense enforces the collection pattern on every request, so a
   leaked `dev` key cannot touch `prod_users` / `prod_groups` / … even
   though the cluster is shared.

4. **Per-stage SSM paths, never shared at the platform level.** All
   three parameters live under
   `/s-platform/{stage}/typesense/{host,api-key-admin,api-key-search}`.
   Module code only ever reads `/s-platform/{currentStage}/...`. Today
   every stage's `host` value points at the same cluster; the day a
   stage moves to its own cluster, only the SSM value changes — **no
   code change is required**.

5. **Event-driven sync, DDB is the source of truth.** Each module's
   existing DDB Streams → EventBridge pipeline feeds an indexer Lambda
   that upserts / deletes Typesense documents. The full source record
   is fetched from DDB on every event to guarantee the index reflects
   the latest persisted state.

## Trade-offs accepted

- **Blast-radius coupling.** A runaway indexer on a PR stage can starve
  the cluster for `prod`. Mitigation: alarm on cluster CPU / RAM.
- **Shared capacity.** One cluster sizes the budget for all stages at
  once. Mitigation: monitor; split before the ceiling bites.
- **Compliance edge.** Arguing "prod data is isolated from dev" becomes
  a scoped-key argument, not a cluster argument. Acceptable while
  pre-GA; must be re-examined before any customer with a hard
  isolation requirement.

## Exit criteria — when to split `prod` onto its own cluster

Split before the **earliest** of:

- **Pre-GA launch.** Prod customers should not share a cluster with
  dev and preview stages.
- **Shared cluster exceeds ~50 % sustained RAM.** Gives headroom for
  the copy without downtime.
- **A customer contract** imposes a physical-isolation requirement for
  search data.
- **Any security incident** touching the shared cluster.

## Migration playbook — shared → per-cluster split

Summary (full SOP when the trigger fires):

1. Provision new Typesense Cloud cluster for `prod`; capture new host
   + admin + search keys.
2. Rotate the existing `prod` scoped keys on the shared cluster so
   `prod_*` collections become read-only to everyone except the new
   cluster's bootstrap.
3. Export `prod_*` collections from shared cluster (Typesense supports
   `GET /collections/{name}/documents/export`).
4. Create the same collections on the new cluster; import the dump.
5. Validate document counts and a sample of queries end-to-end.
6. Flip `/s-platform/prod/typesense/host` (and the two keys) in SSM to
   the new cluster.
7. Redeploy prod module Lambdas (they re-read SSM on cold start).
8. Let events drain, confirm no divergence, drop `prod_*` collections
   from the shared cluster.

No code changes at any step. The abstraction the platform invested in
during phase 3 — per-stage SSM values — is what makes this a
config-only migration.

## Schema evolution (users collection v1 → v2)

v1 indexes only what s-user actually owns: `firstName`, `lastName`,
computed `displayName`, `avatarUrl`, timestamps. **Facets are
intentionally empty in v1** because all the naturally-faceted columns
(status, role, tenantId, department) belong to sibling modules
(`s-authn`, `s-authz`, future identity modules) and require explicit
event-driven denormalization before they can be trusted in an index.

v2 will layer in facets once the cross-module events exist. Not scoped
in this ADR.

## Expected query performance

Ballpark figures for capacity planning against the single shared
Typesense Cloud cluster (0.5 GB RAM baseline, Typesense Cloud's minimum
tier):

- **p50 query latency**: <20 ms for `/user/search` on a dataset up to
  ~50k documents. Dominated by network RTT from Lambda → cluster, not
  engine time.
- **p99 query latency**: <100 ms with warm Lambda; cold start adds
  250–500 ms for the SSM fetch + Typesense client init.
- **Indexing visibility**: <1 s from DDB `INSERT` → searchable
  document, end-to-end (DDB Stream → EventBridge → indexer Lambda →
  Typesense upsert → refresh). No human-visible lag.
- **Result window**: hard-coded to Typesense's default 10k
  (`page * per_page ≤ 10_000`). Beyond that, use the keyset cursor —
  O(1) per page regardless of depth.
- **Scaling trigger**: cluster RAM exceeds ~50 % sustained, or p99
  latency regresses past 200 ms. Either means it's time to bump the
  cluster tier OR split prod onto its own cluster per the exit
  criteria above.

Rate limiting is currently `per_page ≤ 100` server-side. Per-user
request throttling is deferred to API Gateway usage plans; not scoped
in this ADR.

## What this doesn't cover

- Multi-region SDN. Deferred. Single-region today (eu-west-1).
- Other modules' collections (`s-group`, `s-authz`). Same pattern, one
  module at a time.
- Replacing any existing DDB query path outside search. Search is
  additive; nothing is removed.
