# Platform Overview

## What is s-platform?

**s-platform** is a set of DDD bounded-context microservices providing foundational platform capabilities (authentication, authorization, user management, group management) plus business modules built on top. Every module is:

- A **serverless** application on AWS Lambda + API Gateway + DynamoDB.
- **Stateless** and **independently deployable**.
- Owned by a dedicated **engineering AI agent** that operates on its package in isolation.
- Communicating asynchronously via **DynamoDB Streams** and a shared **EventBridge bus**.

The platform is designed to grow to 20+ modules while keeping per-module cognitive load small and deploy/test cycles fast.

## Current Services (foundation layer)

| Service | Purpose |
|---|---|
| **s-authn** | Authentication: login, registration, JWT issuance, JWKS, refresh tokens, password management, magic links |
| **s-authz** | Authorization: roles, permissions, authz-view materialized view, permission checks |
| **s-user** | User profiles: profile CRUD, search, profile sync from auth events |
| **s-group** | Groups: group CRUD, membership management, domain-based auto-assignment |

## Current Services (business modules)

| Service | Purpose |
|---|---|
| **s-building** | Buildings: first resource-scoped module. Building CRUD with scoped permissions (superadmin / admin / manager / user), Typesense-backed admin + user lists, DDB-stream lifecycle events |

Business modules (20+ planned) build on the foundation layer.

## Support Packages

| Package | Purpose |
|---|---|
| **@s/shared** | Shared types, DomainError hierarchy, structured logger, JWT verification SDK, EventBridge publisher, DDB BaseRepository, OpenAPIHono factory |
| **s-tests** | End-to-end integration tests (journey tests) run against a deployed stage |

## Architecture Diagram

```
                          smartiqi.com (Route 53, account: common)
                                     │
                                     │  NS delegation
                                     ▼
                          s-api.smartiqi.com (Route 53, account: itinn-bot)
                                     │
                                     │  {stage}.s-api.smartiqi.com (dev, test)
                                     │  s-api.smartiqi.com (prod)
                                     ▼
                         ┌──────────────────────────┐
                         │ API Gateway v2 (HTTP)    │
                         │ Custom Lambda authorizer │
                         └────────────┬─────────────┘
                                      │ path-based routing
            ┌────────────┬────────────┼────────────┬─────────────┐
            │            │            │            │             │
            ▼            ▼            ▼            ▼             ▼
       /authn/*     /authz/*     /user/*      /group/*      /{module}/*
            │            │            │            │             │
            ▼            ▼            ▼            ▼             ▼
        s-authn      s-authz       s-user       s-group      s-{module}
        Lambda       Lambda        Lambda       Lambda        Lambda
            │            │            │            │             │
            ▼            ▼            ▼            ▼             ▼
        DynamoDB     DynamoDB      DynamoDB     DynamoDB      DynamoDB
        tables       tables        tables       tables        tables
            │            │            │            │             │
            └────────────┴────┬───────┴────────────┴─────────────┘
                              │ DynamoDB Streams
                              ▼
                      Stream Handler Lambda (per module)
                              │
                              ▼
                      EventBridge bus: `platform-events`
                              │
                              │ rule-based routing
                              ▼
                      Event Handler Lambda (per subscriber)
```

## Request Flow

1. Client sends HTTPS request to `{stage}.s-api.smartiqi.com/{module}/...`.
2. API Gateway routes to the module's Lambda based on path prefix.
3. Lambda authorizer validates the JWT (uses JWKS from s-authn).
4. Module's API Lambda loads permissions from `authz_view` (read from DynamoDB).
5. Lambda processes the request, reads/writes its own DynamoDB tables.
6. Writes trigger DynamoDB Streams → stream handler Lambda → EventBridge bus.
7. Subscribing modules receive events via EventBridge rules → their event handler Lambdas.

## Design Principles

### DDD Bounded Contexts

Each module owns a single bounded context. `s-authn` owns credentials and tokens. `s-authz` owns roles and permissions. `s-user` owns profiles. `s-group` owns groups and membership. **No module directly reads another module's DynamoDB tables.** Cross-module reads happen via HTTP APIs or events.

### Event-Driven Integration

Modules communicate asynchronously. When a user registers in s-authn, a `user.registered` event is published to the EventBridge bus. s-user subscribes and creates a profile. New subscribers can be added without touching the publisher. Events are emitted via **DynamoDB Streams** (source of truth is the DB write, not a separate publish step).

### Stateless Lambdas

No in-process state survives a cold start except short-lived caches (JWT cache, authz-view cache). Lambdas scale to zero and spin up on demand.

### Custom JWT + KMS for Inter-Service Auth

s-authn signs JWTs with an RSA-4096 key in AWS KMS. All modules validate tokens via the JWKS endpoint. No shared secrets to distribute across 20+ services. Same pattern you used on GCP, AWS-native implementation.

### Authz-View Materialized View

s-authz maintains a denormalized `authz_view` DynamoDB table keyed by user ID, containing each user's flat permission list. All modules read this directly and cache it in memory. When roles or group memberships change, s-authz rebuilds affected entries (triggered by events from s-group, etc.).

### Engineering AI Agent per Module

Each `packages/s-{module}/` has a dedicated AI agent that:

- Reads only its own package directory + `packages/shared/`.
- Writes code, unit tests, and integration tests for its module.
- Maintains its module's `/info` endpoint contract and OpenAPI spec.
- Validates changes against a per-PR ephemeral AWS stage before merging.

CODEOWNERS enforces that agents don't touch other modules without cross-agent coordination.

### Per-PR Ephemeral Stages

Every pull request gets a fully isolated AWS stack via `sst deploy --stage pr-{number}`. Integration tests in s-tests run against the PR stage, giving agents real AWS feedback — not mocked unit tests. On PR close, the stage is destroyed (zero idle cost).

### Mandatory Endpoints per Module

Every deployed module exposes four endpoints, no exceptions:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | Public | Uptime check, `{ status: "ok" }`, no dependencies |
| `GET /info` | Authenticated | Service metadata: permissions catalog, events published/subscribed, topics |
| `GET /openapi.json` | Public | Auto-generated OpenAPI 3.1 spec from Zod schemas |
| `GET /docs` | Public | Swagger UI |

See [09-api-conventions.md](09-api-conventions.md).

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| API p95 latency | < 300 ms warm, < 2 s cold |
| Uptime | 99.9% per module (prod) |
| Event delivery | At-least-once via DynamoDB Streams + EventBridge |
| Idempotency | All event handlers MUST be idempotent |
| Cost at zero traffic | < $5/month per module (true scale-to-zero) |
| Deploy frequency | Multiple times per day (any agent, any module) |
| PR feedback loop | < 5 minutes from push to integration test results |

## What is Intentionally NOT Here

- **No Kubernetes.** No containers. No cluster management. Pure Lambda + managed services.
- **No cross-module DB access.** Hard rule. Reads go via HTTP APIs, writes fire events.
- **No shared code outside `@s/shared`.** If two modules need the same logic and it's not auth/events/errors/logger, question whether the bounded contexts are drawn correctly.
- **No synchronous service-to-service chains.** If `s-user` needs something from `s-authn`, it caches it or uses an event-driven lookup.
- **No "just this once" pattern breaks.** Consistency is the whole point — every module being predictable is what lets one AI agent build a new module from scratch by reading the spec.
