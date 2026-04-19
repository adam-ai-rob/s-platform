# GitHub Collaborator Setup

The `robo-sk` user has been invited as **admin** on `adam-ai-rob/s-platform`. This runbook is what to do after accepting.

## Step 1: Accept the invitation (as robo-sk)

1. Log in to GitHub as `robo-sk`.
2. Open the invitation and click **Accept invitation**:
   - https://github.com/adam-ai-rob/s-platform/invitations
3. Verify admin access by visiting the repo **Settings** tab — you should see it.

## Step 2: Set up git locally (as robo-sk)

Make sure your local git identity is `robo-sk` for commits to this repo.

```bash
# Inside s-platform clone
cd ~/Projects/working/s-platform
git config user.name "robo-sk"
git config user.email "<robo-sk's email>"
```

For SSH push access, ensure an SSH key for the `robo-sk` GitHub account is in `~/.ssh/` and loaded.

## Step 3: Add prod approval reviewer

Configure the `prod` environment to require approval from `robo-sk` before deploy:

1. GitHub → repo → **Settings** → **Environments** → **prod**
2. Under **Deployment protection rules**, enable **Required reviewers**
3. Add `robo-sk`
4. (Optional) Add a wait timer (e.g., 5 minutes) before deploy runs
5. Under **Deployment branches**, select **Selected branches** → add `stage/prod`

This ensures no one can accidentally deploy to prod without `robo-sk` approval.

## Step 4: Rotate the PAT used during setup

The PAT `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` (under `adam-ai-rob`) is no longer needed. Revoke it:

1. Go to https://github.com/settings/tokens (logged in as `adam-ai-rob`)
2. Find the token and click **Delete**

Future commits and admin operations use `robo-sk`'s own credentials.

## Step 5: Verify commit workflow as robo-sk

Make a small test commit (e.g., fix a typo in a doc) and push to a feature branch. Verify:

- The commit author is `robo-sk`
- Push succeeds without issues
- GitHub Actions CI runs correctly (typecheck/lint/test)

## Who owns what now

| Repo | Owner (GitHub) | Admin collaborators |
|---|---|---|
| adam-ai-rob/s-platform | adam-ai-rob | robo-sk |

Both accounts can:
- Push / merge / manage settings / manage secrets
- Configure environments and protection rules
- Invite additional collaborators

Only `adam-ai-rob` (owner) can:
- Transfer repo ownership
- Delete the repo

## Troubleshooting

- **"Invitation expired":** invitations auto-expire after 7 days. Re-send via Settings → Collaborators.
- **Can't see Settings tab:** invitation not accepted, or account has wrong permission level.
- **Push rejected:** ensure SSH key or PAT belongs to the correct account (`git config user.email` is local — GitHub auth is separate).
