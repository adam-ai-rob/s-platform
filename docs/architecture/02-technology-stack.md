# Technology Stack

Every technology choice in s-platform is intentional. This document explains what each technology is, why it was chosen over alternatives, and how it is used.

## Runtime: Bun

**Version:** 1.x

**What:** Bun is a JavaScript/TypeScript runtime built on JavaScriptCore (Safari's engine) with native TypeScript support, a built-in test runner, and a built-in package manager.

**Why Bun:**

- Native TypeScript execution — no `tsc` compilation step for development
- Faster startup, faster HTTP serving, faster package installs than Node.js
- Built-in test runner (`bun test`) — no Jest/Vitest dependency
- Single workspace tool — `bun install`, `bun run`, `bun test`

**How used:**

- Local development: `bun dev`, `bun test`, `bun run`
- CI: all GitHub Actions use `oven-sh/setup-bun@v1`
- Lambda runtime: Bun runs in Lambda via SST v3's bun deployment target (confirmed working in production with bikes-api)
- Workspace package manager (`bun install` at repo root installs all packages)

**Never use `npm` or `npx`.** Use `bun` and `bunx`.

## HTTP Framework: Hono (OpenAPIHono variant)

**Version:** 4.x

**What:** Hono is a lightweight, TypeScript-first, middleware-based HTTP framework. `@hono/zod-openapi` (OpenAPIHono) extends it with automatic OpenAPI spec generation from Zod schemas.

**Why Hono + OpenAPIHono:**

- Runtime-agnostic (Bun, Node, Lambda via `@hono/aws-lambda`)
- Type-safe context variables, route parameters, middleware
- OpenAPIHono auto-generates `/openapi.json` from route definitions — no manual spec maintenance
- Small, fast, no legacy baggage

**How used:**

- Each module defines an `OpenAPIHono<AppEnv>` app in `packages/s-{module}/functions/src/api.ts`
- Lambda handler wraps the app via `handle(app)` from `@hono/aws-lambda`
- Swagger UI served at `/docs` via `@hono/swagger-ui`
- Routes registered with `app.openapi(route, handler)` for OpenAPI-aware routes
- Standard Hono `app.get("/health", ...)` for routes not needing OpenAPI exposure

## Validation: Zod

**What:** TypeScript-first schema validation with runtime validation and static type inference from one schema definition.

**How used:**

- All request bodies validated via OpenAPIHono route definitions (automatic)
- Response schemas defined as Zod objects and returned in OpenAPI spec
- Entity types inferred from Zod schemas: `type User = z.infer<typeof UserSchema>`
- Schemas live in `packages/s-{module}/functions/src/schemas/*.schema.ts`
- Shared schemas (pagination, common envelopes) live in `@s/shared`

## Database: DynamoDB

**What:** AWS-managed serverless NoSQL database. Single-digit-millisecond reads/writes, scale-to-zero pricing on on-demand mode.

**Why DynamoDB over alternatives:**

- **Serverless** — on-demand billing, no capacity planning
- **Fast** — single-digit ms for key lookups, predictable at any scale
- **Streams** — change data capture feeds directly into Lambda event handlers (our event-driven pattern)
- **Global Tables** — cross-region active-active available if needed later
- **SST integration** — `sst.aws.Dynamo` handles tables, streams, and IAM in a few lines

**Tradeoffs:**

- Query model is access-pattern driven (you design GSIs upfront)
- No joins, no ad-hoc queries — denormalize or use events

**How used:**

- One or more tables per module, defined in `infra/s-{module}.ts`
- All tables have `stream: "new-and-old-images"` enabled
- `@s/shared/ddb/BaseRepository` wraps DDB SDK calls with typed methods (`get`, `put`, `patch`, `delete`, `queryByIndex`)
- IDs are ULIDs stored as strings; timestamps are ISO 8601 strings

See [08-data-access-patterns.md](08-data-access-patterns.md).

## Search (optional, per-module): Algolia

**What:** Managed search-as-a-service for full-text search, faceted filtering, typo tolerance.

**When to use:** Only modules with genuine full-text search requirements (e.g., admin user search, business module item search). **Most modules should rely on DynamoDB GSIs alone.**

**How used (when needed):**

- DynamoDB Streams → stream handler Lambda → Algolia index (CQRS-lite pattern)
- Reads split: by-ID reads go to DynamoDB, search queries go to Algolia
- Algolia search-only API key is safe for public clients
- Firebase-extension-equivalent sync pattern; ~50 lines of stream handler code per indexed collection

**Cost:** Free tier (100k records + 10k searches/month) covers small-scale usage indefinitely.

## Infrastructure as Code: SST v3 (Ion)

**Version:** 3.x (Pulumi-based)

**What:** SST is a TypeScript-first framework for building serverless apps on AWS. v3 ("Ion") uses Pulumi under the hood. Provides high-level constructs for Lambda, API Gateway, DynamoDB, EventBridge, etc.

**Why SST over raw CDK or Pulumi:**

- Higher-level constructs reduce boilerplate (`sst.aws.Function`, `sst.aws.Dynamo`, `sst.aws.ApiGatewayV2`)
- Per-stage deploys first-class (`sst deploy --stage dev`, `--stage pr-42`)
- `sst dev` live Lambda development — local code connected to deployed AWS resources
- Strong TypeScript types throughout IaC
- Link abstractions: `link: [table]` automatically grants IAM and sets env vars

**How used:**

- Single `sst.config.ts` at monorepo root
- `infra/` directory with per-module stack files (`infra/s-authn.ts`, `infra/s-authz.ts`, ...)
- Each stack file exports resources that can be linked by other stacks
- Shared resources (EventBridge bus, KMS, custom domain) in `infra/shared.ts`

See [10-deployment.md](10-deployment.md).

## API Gateway: HTTP API (v2)

**What:** AWS API Gateway HTTP API (v2). Cheaper and faster than REST API (v1). Native Lambda integration.

**Why HTTP API over REST API:**

- ~70% cheaper than REST API
- ~60% lower latency
- Native Lambda integration without extra configuration
- Built-in CORS, JWT authorizers

**How used:**

- **One shared API Gateway** for the entire platform (`PlatformGateway`), defined in `infra/shared.ts`
- Custom domain: `{stage}.s-api.smartiqi.com` (prod: `s-api.smartiqi.com`)
- Each module's stack adds path-prefixed routes: `ANY /{module}/{proxy+}` → module Lambda
- Custom Lambda authorizer (bearer JWT) applied to protected routes; `/health`, `/docs`, `/openapi.json` are public

See [09-api-conventions.md](09-api-conventions.md) and [10-deployment.md](10-deployment.md).

## Event Bus: EventBridge

**What:** AWS-managed event router. Custom bus `platform-events` routes events between modules via rules.

**Why EventBridge:**

- Managed (no Kafka/RabbitMQ cluster)
- Rule-based routing decouples publishers from subscribers
- Native integrations with Lambda, SQS, Step Functions
- Archive + replay for event history
- Pattern-matching rules (e.g., subscribe to `source=s-authn, detail-type=user.*`)

**How used:**

- One custom bus `platform-events` in `infra/shared.ts`
- Events published via DynamoDB Streams → stream handler Lambda → EventBridge (CDC pattern — source of truth is the DB write)
- Subscriber modules declare EventBridge rules in their stack files targeting their event handler Lambda
- Optional SQS queue between EventBridge rule and subscriber Lambda for backpressure buffering

See [05-events-and-messaging.md](05-events-and-messaging.md).

## Authentication: Custom JWT + AWS KMS

**What:** s-authn signs JWTs using an RSA-4096 key in AWS KMS. Other modules verify tokens via s-authn's JWKS endpoint.

**Why custom JWT over Cognito:**

- You already have the implementation pattern from your GCP setup — minimal migration cost
- Full control over token payload, claims, and refresh flow
- No Cognito feature lock-in

**How used:**

- KMS RSA-4096 key in AWS KMS (`alias/s-authn-jwt-key-{stage}`)
- `s-authn` calls `kms:Sign` with algorithm `RSASSA_PKCS1_V1_5_SHA_256` (RS256)
- JWKS endpoint: `GET /authn/auth/jwks` — returns public key set
- Consuming modules use `jose.createRemoteJWKSet` with 1-hour cache
- Custom Lambda authorizer (shared in `@s/shared`) validates the bearer token + loads `authz_view` for permissions

See [04-authentication-and-authorization.md](04-authentication-and-authorization.md).

## Authorization: authz-view Materialized View

**What:** Denormalized DynamoDB table (`authz_view`) maintained by s-authz. Maps each user to their flat permission list.

**Why a materialized view:**

- One DB read per user instead of resolving role → permission → group chains per request
- Consuming modules don't depend on s-authz being available at request time
- Aggressive in-memory caching (5 min prod, 1 min dev) eliminates most DB reads

**How used:**

- Lambda authorizer reads `authz_view` for the authenticated user
- Permissions: flat list of `{ id: string; value?: unknown[] }` — simple or value-scoped
- `requirePermission("user_admin")` middleware checks the list
- s-authz rebuilds entries on role or group membership change (triggered via EventBridge events)

See [04-authentication-and-authorization.md](04-authentication-and-authorization.md).

## Linting & Formatting: Biome

**What:** Fast, all-in-one linter and formatter written in Rust. Replaces ESLint + Prettier.

**Why Biome:**

- Orders of magnitude faster than ESLint + Prettier
- One config file, one command, no plugin hell
- Consistent formatting across modules without bikeshedding
- First-class TypeScript + JSX support

**How used:**

- `biome.json` at monorepo root (shared config for all packages)
- `bun run lint` = `biome check --write` (format + lint, auto-fix)
- `bun run lint:check` = `biome check` (CI check, no auto-fix)
- CI fails if `biome check` finds issues

**Never use ESLint or Prettier.** Biome handles both.

## Password Hashing: argon2id

**Library:** `@node-rs/argon2`

**What:** OWASP-recommended memory-hard password hashing. Native Rust binding for Node.js/Bun.

**Why argon2id:**

- OWASP's top recommendation for password hashing
- Memory-hard → resistant to GPU/ASIC attacks
- Native binding avoids pure-JS performance penalty

**How used:**

- Only inside `s-authn` (password-handling module)
- Stored as `$argon2id$...` strings in DynamoDB
- Verification uses `argon2.verify(hash, plaintext)` (constant-time)

## IDs: ULID

**What:** 128-bit lexicographically sortable identifier.

**Why ULID over UUID v4:**

- Time-sortable → natural cursor-based pagination
- Globally unique without coordination
- Compact (26 chars Crockford Base32 vs 36 for UUID)

**How used:**

- Every document's `id` field is a ULID
- Generated via `ulid()` from the `ulid` npm package
- Used as cursor values for pagination (lex sort = chronological sort)
- Used as correlation IDs for events

## Logging: Structured JSON → CloudWatch

**What:** All Lambdas log JSON objects to stdout. Lambda runtime sends stdout to CloudWatch Logs. CloudWatch Logs Insights parses JSON fields for querying.

**Why structured JSON:**

- CloudWatch Logs Insights understands JSON natively — no parsing config
- Fields are searchable, filterable, aggregatable
- Trace IDs link log entries across Lambdas for distributed tracing

**How used:**

- `@s/shared/logger` utility — `logger.info(message, { fields })`
- Required fields: `severity`, `message`, `service`, `stage`, `traceId`
- Emoji prefixes for scannability: 🚀 start, ✅ success, ❌ error, 🔍 debug, ⚠️ warning
- Never log secrets (passwords, tokens, JWTs, API keys)

See [06-logging-and-observability.md](06-logging-and-observability.md).

## Distributed Tracing: AWS X-Ray + W3C traceparent

**What:** X-Ray collects distributed traces across AWS services. W3C traceparent header propagates trace context between modules.

**How used:**

- X-Ray enabled on all Lambdas (`tracing: "active"` in SST)
- `@s/shared/trace` middleware extracts or generates `traceparent` header
- Trace ID embedded in every log entry
- Search logs by trace ID to see all activity for a single request

## CI/CD: GitHub Actions + AWS OIDC

**What:** GitHub Actions for CI/CD. AWS OIDC federation for keyless authentication.

**Why OIDC over AWS access keys:**

- No long-lived credentials in GitHub Secrets
- Short-lived tokens generated per workflow run
- Full audit trail in CloudTrail

**How used:**

- AWS IAM OIDC provider for `token.actions.githubusercontent.com`
- IAM role `GitHubActionsRole` with trust policy scoped to specific repos
- Workflows assume the role via `aws-actions/configure-aws-credentials@v4`
- Per-stage GitHub environments with protected secrets

See [10-deployment.md](10-deployment.md).

## Versioning: CalVer

**Format:** `vYYYY.MM.N` (e.g., `v2026.04.1`)

- `YYYY.MM` = year-month of release
- `N` = sequential release in that month

**When to cut:** On merge to `stage/prod`.

**How:**

1. Rename `## Unreleased` in `RELEASE_NOTES.md` to `## v2026.MM.N — YYYY-MM-DD`.
2. Create git tag `v2026.MM.N`.
3. Add a fresh `## Unreleased` section at top.

## Common Dependencies (Standard Stack)

Every module includes these dev + runtime dependencies:

**Runtime (in `dependencies`):**

- `@hono/zod-openapi` — OpenAPIHono
- `@hono/swagger-ui` — Swagger UI middleware
- `@hono/aws-lambda` — Lambda adapter for Hono
- `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`
- `@aws-sdk/client-eventbridge`
- `@aws-sdk/client-kms` (s-authn only)
- `zod`
- `ulid`
- `jose` (JWT verification; s-authn also signs)
- `@s/shared` (workspace dependency)

**Dev (in `devDependencies`):**

- `@biomejs/biome`
- `@types/aws-lambda`
- `@types/node`
- `aws-sdk-client-mock` (unit tests)
- `sst` (IaC, workspace root only)
- `typescript`

## Forbidden Technologies

- ❌ **ESLint, Prettier** — use Biome
- ❌ **npm, npx, yarn, pnpm** — use `bun` and `bunx`
- ❌ **Jest, Vitest, Mocha** — use `bun test`
- ❌ **Express, Fastify, Koa** — use Hono
- ❌ **Mongoose, TypeORM, Prisma** — use BaseRepository over DynamoDB directly
- ❌ **AWS SDK v2** — use AWS SDK v3 (`@aws-sdk/*`)
- ❌ **Raw CDK** — use SST v3 constructs; drop to raw Pulumi/CDK only for escape hatches
- ❌ **Joi** — use Zod
- ❌ **UUID v4** — use ULID
