# GPT-Driven SDLC

This repo uses an issue-first GPT workflow. The goal is to make AI-assisted changes traceable, reviewable, and deployable without losing engineering discipline.

## Required Flow

1. Start from a GitHub issue with clear acceptance criteria.
2. Run a planning pass before implementation for non-trivial work.
3. Implement on a feature branch.
4. Open a PR with a conventional title and issue reference.
5. Run local validation and GitHub CI.
6. Use an independent reviewer agent or human reviewer.
7. Fix valid findings and explain intentionally rejected findings.
8. Merge only after explicit approval and green checks.
9. Deploy only by sequential fast-forward promotion when requested: `main` to `stage/dev`, `stage/dev` to `stage/test`, then `stage/test` to `stage/prod`.
10. Watch every deploy workflow to completion and report run links.

## Naming

Use the issue number everywhere a human scans history.

| Item | Format | Example |
|---|---|---|
| Branch | `codex/<issue>-<short-slug>` | `codex/105-authz-assignment-value-cap` |
| PR title | `<type>(<scope>): <summary> (#<issue>)` | `security(s-authz): cap assignment scope values (#105)` |
| Commit subject | `<type>(<scope>): <summary> (#<issue>)` | `security(s-authz): cap assignment scope values (#105)` |
| PR body | `Closes #<issue>` | `Closes #105` |

Use another agent prefix only when that agent owns the branch:

```text
jules/105-authz-assignment-value-cap
human/105-authz-assignment-value-cap
```

If there is no issue number, create an issue first unless the change is trivial documentation cleanup.

## Roles

Use separate GPT roles for non-trivial work:

| Role | Responsibility |
|---|---|
| Planner | Reads the issue and codebase, then writes current behavior, affected files, implementation plan, test plan, docs/contracts impact, and risks. Does not edit. |
| Implementer | Applies the plan, keeps scope narrow, updates tests/docs/contracts, opens the PR, and records validation. |
| Reviewer | Independently reviews for bugs, security regressions, missing validation, stale docs/contracts, missing tests, and deployment risks. |
| CI investigator | Inspects failing checks and logs before changing code. Applies the smallest valid fix. |
| Release manager | Merges after approval, promotes through the requested stage chain, watches deploys, and reports status. |

## Planning Prompt

```markdown
Read issue #<issue> and the surrounding code. Do not implement yet.

Produce:
- current behavior summary
- affected modules/files
- implementation plan
- test plan
- docs/contracts that must be updated
- compatibility and deployment risks

Follow existing project patterns. If anything is ambiguous, make the safest assumption and call it out.
```

## Implementation Prompt

```markdown
Implement issue #<issue> following the approved plan.

Requirements:
- use branch `codex/<issue>-<short-slug>`
- use PR title and commit subject format `<type>(<scope>): <summary> (#<issue>)`
- keep scope narrow and follow existing project patterns
- update tests, docs, contracts, README, CLAUDE notes, and Postman when client-facing behavior changes
- run relevant validation
- create a PR with `Closes #<issue>`, summary, validation, review notes, and deployment status
- use `direnv exec .` before all `git` and `gh` commands
```

## Review Prompt

```markdown
Review PR #<pr> as a senior engineer.

Focus on:
- behavioral bugs
- security regressions
- missing validation
- missing tests
- stale docs/contracts/OpenAPI/Postman
- deployment/runtime risks

List findings first, ordered by severity. Use P1/P2/P3 priorities. If there are no actionable issues, say LGTM and mention residual risk.
```

## PR Body

```markdown
Closes #<issue>

## Summary
- ...

## Validation
- [ ] bun run lint:check
- [ ] bun run typecheck
- [ ] bun run test
- [ ] bun run contracts:build
- [ ] GitHub CI

## Review Notes
- Independent GPT/human review status:
- Findings fixed or intentionally not fixed:

## Deployment
- Not deployed yet.
```

## GitHub And Git Identity

This repo uses `.envrc` to select project-local GitHub and git identity. Always run `git` and `gh` through `direnv exec .`:

```bash
direnv exec . git status --short --branch
direnv exec . gh pr view 123
direnv exec . gh api user --jq .login
```

Prefer `git` and `gh` over GitHub MCP tools for identity-sensitive operations: branches, commits, pushes, PR creation, reviews, labels, merges, and deployment branch promotion.

## Merge And Deploy

Deployments are branch-driven:

```text
codex/<issue>-<slug> -> PR -> main -> stage/dev -> stage/test -> stage/prod
```

Rules:

- Never commit directly to `main` or `stage/*`.
- Merge PRs into `main` only after explicit approval.
- Promote sequentially by fast-forwarding `stage/dev` from `main`, `stage/test` from `stage/dev`, and `stage/prod` from `stage/test`.
- Watch every deploy workflow until it completes.
- Report each stage with its GitHub Actions run URL.
