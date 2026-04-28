# s-platform Agent Instructions

All agents working in this repository must read and follow [`CLAUDE.md`](./CLAUDE.md). It is the canonical project-wide instruction file. Module-scoped agents must also read the relevant `packages/s-{module}/CLAUDE.md`.

## Required SDLC Pattern

Use the GPT-driven SDLC rules from `CLAUDE.md` for implementation work:

1. Start from a GitHub issue with acceptance criteria.
2. Branch from `main` using `codex/<issue>-<short-slug>` for Codex-owned work.
3. Use PR titles and implementation commit subjects in this format:

   ```text
   <type>(<scope>): <summary> (#<issue>)
   ```

   Example:

   ```text
   security(s-authz): cap assignment scope values (#105)
   ```

4. Include `Closes #<issue>` in the PR body.
5. Keep implementation, review, CI investigation, and release/deploy work as separate roles when the task is non-trivial.
6. Merge only after explicit approval, green checks, and all valid review findings are addressed.
7. Deploy only when requested by promoting sequentially: `main` to `stage/dev`, `stage/dev` to `stage/test`, then `stage/test` to `stage/prod`; watch every deployment run to completion.

## GitHub And Git Identity

This repo uses `.envrc` for project-local GitHub and git identity. Always run `git` and `gh` commands through `direnv exec .`:

```bash
direnv exec . git status --short --branch
direnv exec . gh pr view 123
direnv exec . gh api user --jq .login
```

Prefer the `git` and `gh` CLIs over GitHub MCP tools for identity-sensitive operations such as branch creation, commits, pushes, PR creation, review comments, merges, labels, and deploy branch promotion.
