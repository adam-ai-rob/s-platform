# Runbook: Typesense Stage Bootstrap

How to wire a stage of `s-platform` to the Typesense search cluster.
Runs once per stage; see ADR
[002](../architecture/adr/002-search-typesense-shared-cluster.md) for
the shared-cluster / stage-prefix design.

> Prerequisite: stage already bootstrapped per
> [fresh-stage-bootstrap.md](./fresh-stage-bootstrap.md).

## What this runbook provisions

For stage `{stage}` it creates, on the shared Typesense cluster:

- An **admin scoped API key** restricted to `collections: {stage}_.*`
- A **search scoped API key** restricted to `collections: {stage}_.*` +
  `actions: documents:search`

> Typesense matches the `collections` field as a **regex**, not a glob.
> `{stage}_.*` (or equivalently `^{stage}_`) limits the key to every
> collection starting with `{stage}_`; the glob-looking `{stage}_*` will
> fail to match and every authenticated call 401s.

…and writes them to SSM under `/s-platform/{stage}/typesense/...`
alongside the cluster hostname.

## Inputs you need

| Variable | Source |
|---|---|
| `STAGE` | Stage name (`dev`, `test`, `prod`, or a personal stage like `robert`) |
| `TYPESENSE_HOST` | Cluster's public host — e.g. `<cluster-id>.a1.typesense.net` |
| `TYPESENSE_MASTER_KEY` | The cluster's **master** API key (one-time use to mint scoped keys). Never written to SSM. |

The master key is stored in the team's password manager — ask in
`#s-platform-ops`. Never paste it into source, issues, PR descriptions,
or chat history.

## Step 1 — Mint scoped keys

Call the Typesense Keys API **twice** (admin + search) from a trusted
workstation. Both responses include a `value` string returned **only on
creation** — capture it into SSM immediately; Typesense cannot
re-display the plaintext after this call.

```bash
export STAGE=robert
export TYPESENSE_HOST='<cluster-id>.a1.typesense.net'
export TYPESENSE_MASTER_KEY='<from-password-manager>'

ADMIN_KEY=$(curl -sS "https://$TYPESENSE_HOST/keys" \
  -H "X-TYPESENSE-API-KEY: $TYPESENSE_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | jq -r '.value'
{
  "description": "s-platform admin $STAGE",
  "actions": ["*"],
  "collections": ["${STAGE}_.*"]
}
JSON
)

SEARCH_KEY=$(curl -sS "https://$TYPESENSE_HOST/keys" \
  -H "X-TYPESENSE-API-KEY: $TYPESENSE_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | jq -r '.value'
{
  "description": "s-platform search $STAGE",
  "actions": ["documents:search"],
  "collections": ["${STAGE}_.*"]
}
JSON
)

[ -n "$ADMIN_KEY" ] && [ -n "$SEARCH_KEY" ] || { echo "key mint failed"; exit 1; }
```

> If either `jq` call yields an empty string, the response was an error.
> Inspect the raw curl output to see what went wrong before retrying —
> Typesense usually reports the reason in the body.

## Step 2 — Write the three SSM parameters

```bash
aws ssm put-parameter \
  --name "/s-platform/${STAGE}/typesense/host" \
  --type String \
  --value "$TYPESENSE_HOST" \
  --overwrite

aws ssm put-parameter \
  --name "/s-platform/${STAGE}/typesense/api-key-admin" \
  --type SecureString \
  --value "$ADMIN_KEY" \
  --overwrite

aws ssm put-parameter \
  --name "/s-platform/${STAGE}/typesense/api-key-search" \
  --type SecureString \
  --value "$SEARCH_KEY" \
  --overwrite

unset ADMIN_KEY SEARCH_KEY TYPESENSE_MASTER_KEY
```

`SecureString` parameters encrypt at rest under the default `aws/ssm`
KMS key, which every module Lambda already has `kms:Decrypt` access to
via its IAM policy.

## Step 3 — (Optional) Backfill existing collections

The search-indexer Lambdas keep their collections in sync for every new
event. For a stage with pre-existing rows (standing up search against
`dev` or `prod` after migration, adding a new collection to a live
stage), invoke the backfill for each collection you need to seed.

**Collections on the platform today:**

- `{stage}_users` — backed by `s-module-user-{stage}-UserBackfill`
- `{stage}_buildings` — backed by `s-module-s-building-{stage}-BuildingBackfill`

```bash
# Users
aws lambda invoke \
  --function-name "s-module-user-${STAGE}-UserBackfill" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"batchSize":500,"maxBatches":1}' \
  /tmp/backfill-users.json
cat /tmp/backfill-users.json

# Buildings
aws lambda invoke \
  --function-name "s-module-s-building-${STAGE}-BuildingBackfill" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"batchSize":500,"maxBatches":1}' \
  /tmp/backfill-buildings.json
cat /tmp/backfill-buildings.json
```

Each response includes a `lastKey` field. When it is `null`, that
collection is fully seeded. Otherwise, invoke again with
`{"startKey": <lastKey>, ...}` until it returns `null`.

## Step 4 — Verify

```bash
# 1. /info should report typesense: { status: "up" }
curl -sS "https://{stage}.s-api.smartiqi.com/user/info" \
  -H "Authorization: Bearer ${JWT}" | jq '.data.probes.typesense'

# 2. /user/search should return (possibly empty) results
curl -sS "https://{stage}.s-api.smartiqi.com/user/search" \
  -H "Authorization: Bearer ${JWT}" | jq
```

## Key rotation

Scoped API keys expire only when explicitly deleted on the cluster. To
rotate:

1. Mint a new admin key via Step 1.
2. `aws ssm put-parameter --name …/api-key-admin --value "$NEW" --overwrite`.
3. Redeploy the module (Lambdas re-read SSM on cold start).
4. Delete the old key on the cluster by its `id` via the Keys API.

Repeat for the search key. Rotate both after any suspected exposure or
employee offboarding.

## Tearing down a stage

Personal stages should drop their collections when the stage is
destroyed — prevents cluster clutter:

```bash
for COLLECTION in "${STAGE}_users" "${STAGE}_buildings"; do
  curl -sS -X DELETE "https://$TYPESENSE_HOST/collections/$COLLECTION" \
    -H "X-TYPESENSE-API-KEY: $ADMIN_KEY"
done
```

And delete the stage's keys from the cluster:

```bash
curl -sS "https://$TYPESENSE_HOST/keys" \
  -H "X-TYPESENSE-API-KEY: $TYPESENSE_MASTER_KEY" \
  | jq ".keys[] | select(.description | test(\"${STAGE}$\")) | .id" \
  | xargs -I {} curl -sS -X DELETE "https://$TYPESENSE_HOST/keys/{}" \
      -H "X-TYPESENSE-API-KEY: $TYPESENSE_MASTER_KEY"
```
