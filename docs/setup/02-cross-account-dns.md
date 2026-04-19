# Cross-Account DNS Delegation for `s-api.smartiqi.com`

Required before the first deploy that uses a custom domain.

## Accounts involved

| Account | ID | Role |
|---|---|---|
| **common** | `679821015569` | Owns the root `smartiqi.com` hosted zone |
| **itinn-bot** | `058264437321` | Owns the `s-api.smartiqi.com` delegated zone |

## What we're creating

```
smartiqi.com                          (Route 53, common account)
│
├── existing records (untouched)
│
└── NS record: s-api                  ───► delegates to itinn-bot
                                            nameservers
s-api.smartiqi.com                    (Route 53, itinn-bot account)
│
├── dev.s-api.smartiqi.com            (created by SST)
├── test.s-api.smartiqi.com           (created by SST)
└── apex (s-api.smartiqi.com) = prod  (created by SST)
```

## Step 1: Create the delegated zone in itinn-bot

```bash
aws route53 create-hosted-zone \
  --profile itinn-bot \
  --name s-api.smartiqi.com \
  --caller-reference "s-api-delegated-zone-$(date +%s)" \
  --hosted-zone-config Comment="Delegated zone for s-platform API gateways"
```

Output includes the hosted zone ID (e.g., `Z0123456ABCDEFGH`) and four nameservers:

```
ns-123.awsdns-11.com
ns-456.awsdns-22.net
ns-789.awsdns-33.org
ns-987.awsdns-44.co.uk
```

**Save these nameservers** — you'll need them in step 2.

Or retrieve them later:

```bash
ZONE_ID=$(aws route53 list-hosted-zones --profile itinn-bot \
  --query 'HostedZones[?Name==`s-api.smartiqi.com.`].Id' --output text | awk -F/ '{print $NF}')

aws route53 get-hosted-zone --profile itinn-bot --id "$ZONE_ID" \
  --query 'DelegationSet.NameServers'
```

## Step 2: Add NS record in the common account's zone

Find the existing `smartiqi.com` zone ID in the common account:

```bash
aws route53 list-hosted-zones --profile common \
  --query 'HostedZones[?Name==`smartiqi.com.`].Id' --output text
```

Example output: `/hostedzone/Z0190866286PJ0PHA8DR8`

Create the NS delegation record (replace NS values with the ones from step 1):

```bash
PARENT_ZONE_ID="Z0190866286PJ0PHA8DR8"  # smartiqi.com in common account

cat > /tmp/ns-delegation.json <<JSON
{
  "Changes": [{
    "Action": "CREATE",
    "ResourceRecordSet": {
      "Name": "s-api.smartiqi.com",
      "Type": "NS",
      "TTL": 300,
      "ResourceRecords": [
        { "Value": "ns-123.awsdns-11.com." },
        { "Value": "ns-456.awsdns-22.net." },
        { "Value": "ns-789.awsdns-33.org." },
        { "Value": "ns-987.awsdns-44.co.uk." }
      ]
    }
  }]
}
JSON

aws route53 change-resource-record-sets \
  --profile common \
  --hosted-zone-id "$PARENT_ZONE_ID" \
  --change-batch file:///tmp/ns-delegation.json

rm /tmp/ns-delegation.json
```

## Step 3: Verify delegation

Wait ~1 minute for DNS propagation, then:

```bash
dig +short NS s-api.smartiqi.com @8.8.8.8
```

Expected: the four nameservers you added in step 2.

Alternatively:

```bash
nslookup -type=NS s-api.smartiqi.com 8.8.8.8
```

## What happens next

SST will automatically manage records inside the `s-api.smartiqi.com` zone as you deploy stages:

| Stage | Record created |
|---|---|
| `dev` | `dev.s-api.smartiqi.com` (A/AAAA → API Gateway) |
| `test` | `test.s-api.smartiqi.com` (A/AAAA → API Gateway) |
| `prod` | `s-api.smartiqi.com` (A/AAAA → API Gateway) — apex record |
| `pr-N` | (no custom domain — uses default API Gateway URL) |

ACM certificates are auto-provisioned by SST via DNS validation in the delegated zone.

## Troubleshooting

- **`dig` returns nothing after 5 minutes:** NS record not yet propagated from the parent zone, or TTL on cached resolvers. Try `dig @ns-{nameserver-from-parent}.amazon.com` directly.
- **Certificate validation times out on first deploy:** ACM may take up to 15 minutes to validate via DNS. Check the ACM console in itinn-bot.
- **Delegation loop:** ensure the NS values in step 2 are the nameservers **of the delegated zone in itinn-bot**, not the parent zone.
