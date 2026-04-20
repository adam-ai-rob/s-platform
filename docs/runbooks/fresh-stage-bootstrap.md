# Runbook: Fresh-Stage Bootstrap

How to stand up a new `s-platform` stage (dev, test, prod, or a scratch
`phase3-{name}` stage) from zero, using the Phase-3 split where the
platform tier and each module deploy independently.

> **Status (2026-04):** All four modules (`s-authz`, `s-authn`,
> `s-user`, `s-group`) are now independently deployable from
> `modules/s-{name}/`. Validated end-to-end on the `phase3-dev` scratch
> stage — 12/12 journey tests pass. The root `sst.config.ts` + `infra/`
> still own the existing `dev` / `test` / `prod` stages until the final
> cut-over PR lands; fresh stages should use the per-module apps
> described below.

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

## Step 2 — Deploy s-authz

```bash
cd modules/s-authz
bun sst deploy --stage phase3-dev
```

This reads the platform outputs from SSM at deploy time, creates its own
DDB tables + Lambdas + stream/event handlers, registers
`ANY /authz/{proxy+}` against the imported gateway via raw Pulumi
(`aws.apigatewayv2.Integration` + `Route` + a `Lambda.Permission` scoped
to the `/authz/*` source ARN), and additionally publishes:

```
/s-platform/{stage}/authz-view-table-name
/s-platform/{stage}/authz-view-table-arn
```

Every other module's API Lambda will pick those up at deploy time —
`authz-view-table-name` as the `AUTHZ_VIEW_TABLE_NAME` env var, the ARN
as an IAM-policy resource for `dynamodb:GetItem`.

Verify:

```bash
aws ssm get-parameters-by-path \
  --path /s-platform/phase3-dev \
  --region eu-west-1 --profile itinn-bot \
  --query 'Parameters[?contains(Name, `authz`)].Name'
```

Smoke-test the route (no auth required on `/health`):

```bash
GW=$(aws ssm get-parameter --name /s-platform/phase3-dev/gateway-url \
  --region eu-west-1 --profile itinn-bot --query 'Parameter.Value' --output text)
curl -sS $GW/authz/health          # {"status":"ok"}
curl -sS -o /dev/null -w '%{http_code}\n' $GW/authz/info   # 401 (Missing Bearer token — expected)
curl -sS $GW/authz/openapi.json | head -c 200               # OpenAPI 3.1 spec
```

## Step 3 — Deploy the remaining modules

```bash
cd modules/s-authn && bun sst deploy --stage phase3-dev
cd modules/s-user  && bun sst deploy --stage phase3-dev
cd modules/s-group && bun sst deploy --stage phase3-dev
```

The three can deploy in parallel — they each only depend on
`platform/` + `s-authz` being up already. Each module's `sst.config.ts`
reads the platform outputs + the authz-view table name + ARN from SSM
and registers its routes against the imported gateway id.

s-authn additionally reads `jwt-signing-key-arn` to attach a
`kms:Sign` + `kms:GetPublicKey` policy on the API Lambda.

Smoke-test every module's public `/health` endpoint:

```bash
GW=$(aws ssm get-parameter --name /s-platform/phase3-dev/gateway-url \
  --region eu-west-1 --profile itinn-bot --query 'Parameter.Value' --output text)
for m in authn authz user group; do
  printf "/%s/health → " "$m"
  curl -sS -w "HTTP %{http_code}\n" $GW/$m/health
done
```

All four should return `{"status":"ok"} HTTP 200`.

## Step 4 — Run the auth journey

```bash
STAGE=phase3-dev \
  API_URL=$(aws ssm get-parameter --name /s-platform/phase3-dev/gateway-url \
    --region eu-west-1 --profile itinn-bot --query 'Parameter.Value' --output text) \
  bun run test:e2e
```

Expect 12/12 in `packages/s-tests/src/journeys/auth.journey.test.ts`.

**Cold-start caveat on a brand-new stage:** the first register in a
fresh stage warms three cold Lambdas in series (s-authn stream handler
→ s-user/s-group/s-authz event handlers) — DDB Streams + EventBridge
delivery on top of that can push total latency to ~20s. The journey's
`eventually()` window is 15s. If you see test [2] fail with a 404
"Profile not found" error on the first run of a new stage, warm the
pipeline with one manual register and re-run:

```bash
curl -sS -X POST $GW/authn/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"warmup-'$(date +%s)'@example.com","password":"Warmup1234!"}' \
  > /dev/null
sleep 20
STAGE=phase3-dev API_URL=$GW bun run test:e2e   # should hit 12/12
```

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
- **SST's nested `bun install` fails with 401 against a private mirror:**
  SST spawns its own `bun install` inside `{app}/.sst/platform/` which
  doesn't always inherit the repo-root `bunfig.toml`. Each SST app has
  its own `bunfig.toml` to pin the registry to public npm, but if a
  user-level `~/.npmrc` has an expired token AWS CodeArtifact /
  JFrog / GitHub Packages still wins. Prefix the deploy command with
  `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/` to override for that
  invocation, or refresh the mirror token.
