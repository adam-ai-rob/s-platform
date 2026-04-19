# Platform Architecture

Architecture specification for the **s-platform** — a serverless, event-driven, DDD-based microservice platform on AWS.

These docs are the single source of truth for how modules are built, deployed, tested, and operated. Every service and business module follows these conventions. AI agents and humans must read the relevant docs before writing code.

## Table of Contents

| Document | Description |
|---|---|
| [Platform Overview](01-overview.md) | What the platform is, current services, architecture diagram, design principles |
| [Technology Stack](02-technology-stack.md) | Every technology used, why it was chosen, how it is configured |
| [Service Structure](03-service-structure.md) | Monorepo layout, per-module package structure, file naming conventions |
| [Authentication & Authorization](04-authentication-and-authorization.md) | Custom JWT via KMS, JWKS, authz-view, permission model, inter-service auth |
| [Events & Messaging](05-events-and-messaging.md) | DynamoDB Streams, EventBridge bus, envelope format, idempotency, backpressure |
| [Logging & Observability](06-logging-and-observability.md) | Structured CloudWatch logging, X-Ray tracing, dashboards, log queries |
| [Error Handling](07-error-handling.md) | DomainError hierarchy, HTTP status mapping, global error handler |
| [Data Access Patterns](08-data-access-patterns.md) | DynamoDB single-table design, BaseRepository, GSIs, pagination, TTL |
| [API Conventions](09-api-conventions.md) | OpenAPIHono, mandatory /health /info /openapi.json /docs, responses, pagination |
| [Deployment](10-deployment.md) | SST stages, per-PR ephemeral environments, custom domains, canary releases |
| [Local Development](11-local-development.md) | Bun, SST dev mode, environment setup, testing |

One-time setup runbooks live in [`../setup/`](../setup/README.md).

## Quick Facts

| | |
|---|---|
| **Cloud** | AWS (eu-west-1) |
| **Account** | `058264437321` (itinn-bot) |
| **DNS zone** | `s-api.smartiqi.com` (delegated from `smartiqi.com` in account `679821015569`) |
| **Runtime** | Bun 1.x (local dev + Lambda) |
| **IaC** | SST v3 (Ion, Pulumi-based) |
| **Repo** | [adam-ai-rob/s-platform](https://github.com/adam-ai-rob/s-platform) (monorepo — code + docs) |
| **Versioning** | CalVer `vYYYY.MM.N` |
| **Stages** | `dev`, `test`, `prod`, plus ephemeral `pr-{N}` per pull request |

## Who This Is For

- **Engineering AI agents** — each module has its own agent that must read the relevant docs before writing code. See [service-structure.md](03-service-structure.md#per-module-ai-agent-ownership).
- **Humans** — reviewers, operators, and new engineers onboarding to the platform.

## Non-Goals

- This is not a tutorial. It assumes familiarity with AWS, TypeScript, and serverless.
- This is not a decision log. For historical context, see commit history.
- This is not product documentation. For what the platform *does*, see individual module `README.md`s under `packages/`.

## How to Contribute

These docs live inside the s-platform monorepo. Changes follow the same PR workflow as code (see the [root `CLAUDE.md`](../../CLAUDE.md)). Architecture changes that affect a module must update both the doc and the module's `CLAUDE.md` in the same PR.
