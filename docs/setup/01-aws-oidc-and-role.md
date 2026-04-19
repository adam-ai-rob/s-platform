# AWS OIDC Provider + GitHubActionsRole

One-time setup to let GitHub Actions deploy to AWS without long-lived access keys.

**Account:** `058264437321` (itinn-bot)
**Region:** `eu-west-1`
**Profile:** `itinn-bot`

## What this creates

1. **IAM OIDC identity provider** trusting `token.actions.githubusercontent.com`
2. **IAM role `GitHubActionsRole`** with a trust policy scoped to `adam-ai-rob/*` repositories
3. **Broad permissions** (`AdministratorAccess`) for initial deploys — scope down after first successful deploy

## Option A: AWS CLI (fastest, script below)

Save as `setup-github-oidc.sh` and run locally with the `itinn-bot` profile.

```bash
#!/usr/bin/env bash
set -euo pipefail

PROFILE="itinn-bot"
ACCOUNT_ID="058264437321"
ROLE_NAME="GitHubActionsRole"
GH_ORG_OR_USER="adam-ai-rob"

echo "===> Creating OIDC provider for GitHub Actions"
aws iam create-open-id-connect-provider \
  --profile "$PROFILE" \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  || echo "OIDC provider already exists (ignore error above)"

OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

echo "===> Writing trust policy"
cat > /tmp/gh-oidc-trust-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GH_ORG_OR_USER}/*:*"
        }
      }
    }
  ]
}
JSON

echo "===> Creating role ${ROLE_NAME}"
aws iam create-role \
  --profile "$PROFILE" \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document file:///tmp/gh-oidc-trust-policy.json \
  --max-session-duration 3600 \
  --description "Role assumed by GitHub Actions via OIDC for s-platform deploys" \
  || echo "Role already exists (ignore error above)"

echo "===> Attaching AdministratorAccess (scope down later)"
aws iam attach-role-policy \
  --profile "$PROFILE" \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

echo "===> Done. Role ARN:"
aws iam get-role \
  --profile "$PROFILE" \
  --role-name "$ROLE_NAME" \
  --query 'Role.Arn' \
  --output text

rm /tmp/gh-oidc-trust-policy.json
```

**Run:**

```bash
chmod +x setup-github-oidc.sh
./setup-github-oidc.sh
```

Expected final output:

```
===> Done. Role ARN:
arn:aws:iam::058264437321:role/GitHubActionsRole
```

## Option B: Terraform (if you prefer IaC)

Create `setup/github-oidc/main.tf`:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region  = "eu-west-1"
  profile = "itinn-bot"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name                 = "GitHubActionsRole"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:adam-ai-rob/*:*"
        }
      }
    }]
  })
}

# Start broad, scope down after first successful deploy
resource "aws_iam_role_policy_attachment" "admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "role_arn" {
  value = aws_iam_role.github_actions.arn
}
```

Run:

```bash
cd setup/github-oidc
terraform init
terraform apply
```

## Verification

Check the role and its trust policy:

```bash
aws iam get-role --profile itinn-bot --role-name GitHubActionsRole \
  --query 'Role.{Arn:Arn, TrustPolicy:AssumeRolePolicyDocument.Statement[0].Condition}'
```

Expected output includes:

```json
{
  "Arn": "arn:aws:iam::058264437321:role/GitHubActionsRole",
  "TrustPolicy": {
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:adam-ai-rob/*:*"
    }
  }
}
```

## Scoping Down Permissions (after first deploy)

`AdministratorAccess` is too broad for long-term use. After SST successfully deploys the first stage, replace with a scoped policy.

Create `setup/github-oidc/scoped-policy.json` with the minimum permissions SST + deployed resources need:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormation",
      "Effect": "Allow",
      "Action": ["cloudformation:*"],
      "Resource": "*"
    },
    {
      "Sid": "LambdaApiGatewayDynamoEventBridgeKms",
      "Effect": "Allow",
      "Action": [
        "lambda:*",
        "apigateway:*",
        "dynamodb:*",
        "events:*",
        "kms:*",
        "sqs:*",
        "iam:PassRole",
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:GetRolePolicy",
        "iam:ListRoles",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:UpdateAssumeRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "route53:*",
        "acm:*",
        "logs:*",
        "s3:*",
        "ssm:*",
        "sts:GetCallerIdentity",
        "ec2:DescribeRegions",
        "cloudfront:*"
      ],
      "Resource": "*"
    }
  ]
}
```

Then:

```bash
aws iam create-policy --profile itinn-bot \
  --policy-name SPlatformDeployPolicy \
  --policy-document file://scoped-policy.json

aws iam detach-role-policy --profile itinn-bot \
  --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

aws iam attach-role-policy --profile itinn-bot \
  --role-name GitHubActionsRole \
  --policy-arn arn:aws:iam::058264437321:policy/SPlatformDeployPolicy
```

## What the GitHub Workflow Expects

With this role set up, workflows authenticate like:

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/GitHubActionsRole
    aws-region: ${{ vars.AWS_REGION }}
```

The `AWS_ACCOUNT_ID` and `AWS_REGION` vars are already set on the `dev`, `test`, and `prod` GitHub environments.
