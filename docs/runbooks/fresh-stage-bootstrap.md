# Runbook: Fresh-Stage Bootstrap

How to stand up a new `s-platform` stage (dev, test, prod, or a scratch
`phase3-{name}` stage) from zero, using the Phase-3 split where the
platform tier and each module deploy independently.

> **Status (2026-04):** Phase 3 is in progress. Today only the `platform/`
> tier is independently deployable; module SST apps (`modules/s-{name}/`)
> land in follow-up PRs. Until all modules are migrated, existing stages
> (`dev`, `test`, `prod`) keep using the legacy root `sst.config.ts`.
> This runbook describes the end-state; intermediate steps flag what's
> not wired up yet.

## Bootstrap order

```
platform/        →   s-authz          →   s-authn   ─┐
                                                     ├─→ modules that depend on authz-view + bus
                      (writes authz-view-         s-user
                       table-name to SSM)         s-group
```

Rationale:
- `platform/` owns the gateway, bus, KMS key, and alarms topic. Nothing
  else can wire up without these ARNs.
- `s-authz` owns the `AuthzView` table. Every other module's API Lambda
  receives `AUTHZ_VIEW_TABLE_NAME` read from SSM at deploy time; the
  parameter must exist before those modules deploy.
- The remaining modules (s-authn, s-user, s-group) only depend on
  platform primitives + the authz-view SSM key. They can deploy in any
  order relative to each other.

## Step 1 — Deploy the platform tier

```bash
cd platform
bun sst deploy --stage phase3-dev
```

This provisions:

| Resource | SSM key (`/s-platform/{stage}/...`) |
|---|---|
| API Gateway v2 | `gateway-id`, `gateway-url`, `gateway-exec-role-arn` |
| EventBridge bus + 90-day archive | `event-bus-name`, `event-bus-arn` |
| KMS RSA-4096 JWT signing key + alias | `jwt-signing-key-arn`, `jwt-signing-key-alias` |
| SNS alarms topic + email subscription | `alarms-topic-arn` |
| ACM cert + Route 53 A record (`dev`/`test`/`prod` only) | — |

Verify SSM outputs were published:

```bash
aws ssm get-parameters-by-path \
  --path /s-platform/phase3-dev \
  --region eu-west-1 \
  --profile itinn-bot \
  --query 'Parameters[].Name'
```

Expected output (order may vary):

```
/s-platform/phase3-dev/alarms-topic-arn
/s-platform/phase3-dev/event-bus-arn
/s-platform/phase3-dev/event-bus-name
/s-platform/phase3-dev/gateway-exec-role-arn
/s-platform/phase3-dev/gateway-id
/s-platform/phase3-dev/gateway-url
/s-platform/phase3-dev/jwt-signing-key-alias
/s-platform/phase3-dev/jwt-signing-key-arn
```

**First-deploy-only:** SNS emails the confirmation link to the address
in `platform/infra/alarms.ts`. Click it; otherwise DLQ alarms stay in
`PendingConfirmation`.

## Step 2 — Deploy s-authz (planned)

> Not wired yet. In the follow-up PR that lands `modules/s-authz/`:

```bash
cd modules/s-authz
bun sst deploy --stage phase3-dev
```

This will additionally publish `/s-platform/phase3-dev/authz-view-table-name`
so every other module's API Lambda picks it up as
`AUTHZ_VIEW_TABLE_NAME`.

## Step 3 — Deploy the remaining modules (planned)

> Not wired yet. In follow-up PRs that land each module's own SST app:

```bash
cd modules/s-authn && bun sst deploy --stage phase3-dev
cd modules/s-user  && bun sst deploy --stage phase3-dev
cd modules/s-group && bun sst deploy --stage phase3-dev
```

Each module's `sst.config.ts` reads the platform outputs + the authz-view
table name from SSM at deploy time and registers its routes against the
imported gateway id.

## Step 4 — Smoke-test

```bash
STAGE=phase3-dev bun run test:e2e
```

Expect 12/12 in `packages/s-tests/src/journeys/auth.journey.test.ts`.

## Teardown

Reverse order. `bun sst remove` in each module, then `platform`:

```bash
for m in s-group s-user s-authn s-authz; do
  (cd modules/$m && bun sst remove --stage phase3-dev)
done
(cd platform && bun sst remove --stage phase3-dev)
```

SSM parameters under `/s-platform/phase3-dev/*` are removed as part of
each app's teardown.

## Troubleshooting

- **`Parameter /s-platform/{stage}/... not found`** during a module deploy:
  platform/ (or s-authz) hasn't deployed to this stage yet, or deployed
  and then been rolled back. Re-run Step 1 (and Step 2 if the missing key
  is `authz-view-table-name`) and verify with `aws ssm
  get-parameters-by-path`.
- **CORS preflight failing on the custom domain:** custom-domain stages
  (`dev`, `test`, `prod`) have a separate Route 53 + ACM provisioning
  path; SST waits up to 5 min for the cert. First-deploy to a custom
  domain stage can appear to hang — check CloudFormation / Pulumi output
  rather than killing the process.
- **SNS alarm emails still `PendingConfirmation` days later:** check the
  spam folder of the address in `platform/infra/alarms.ts`; AWS
  re-prompts after 3 days; otherwise re-subscribe.
