# Setup Guides

One-time AWS and external-service setup tasks. Each file here is a self-contained runbook.

| File | Purpose |
|---|---|
| [01-aws-oidc-and-role.md](01-aws-oidc-and-role.md) | Create IAM OIDC provider + GitHubActionsRole for GitHub Actions to deploy to AWS |
| [02-cross-account-dns.md](02-cross-account-dns.md) | Delegate `s-api.smartiqi.com` from the common account to itinn-bot |
| [03-github-collaborators.md](03-github-collaborators.md) | Accept repo invitations, configure as robo-sk |

## Execution Order

1. **01-aws-oidc-and-role** — required before any `sst deploy` can run from GitHub Actions
2. **02-cross-account-dns** — required before the first deploy that uses custom domains (can do in parallel)
3. **03-github-collaborators** — accept as `robo-sk`, then rotate the PAT
