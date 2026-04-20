# @s/infra-shared — AI Agent Rules

Infrastructure helpers for the `platform/` and `modules/s-{name}/` SST apps.
**Never imported from runtime Lambda code** — lives at deploy time only.

Read [monorepo CLAUDE.md](../../CLAUDE.md) and [architecture docs](../../docs/architecture/README.md) first.

## Scope

This package exports **only generic SST/Pulumi infrastructure helpers**. It is
the companion to `@s/shared` for the infra layer: `@s/shared` is bundled into
every Lambda; `@s/infra-shared` is only ever imported by `sst.config.ts` files
and the `infra/*.ts` helpers they delegate to.

Allowed surface (see `package.json` `exports`):

| Subpath | Purpose |
|---|---|
| `@s/infra-shared` | `createDlqWithAlarm`, `allowEventBridgeToDlq`, `writeSsmOutput`, `readSsmOutput`, `ssmPrefix` |

## Hard rules

- **Never import from any `packages/s-*` module** — those are runtime code.
- **Never import from `@s/shared`** — that package ships to Lambda; this one doesn't.
- **No business logic** — only reusable resource wiring.
- **No direct `console.log()`** — Pulumi has its own logging; if you need it, use `pulumi.log.*`.
- **Keep `@pulumi/aws` + `@pulumi/pulumi` the only AWS-resource deps** — no AWS SDK here.

## Design notes

- Every helper accepts `stage: string` explicitly rather than reading `$app.stage`. This keeps the package consumable from any SST app (platform or module) without relying on the SST global namespace.
- `writeSsmOutput` / `readSsmOutput` use `/s-platform/{stage}/{key}` as the canonical prefix. Producers set; consumers read. No SST-app code imports another SST-app file.

## Forbidden

- ❌ Importing from `packages/s-*` or `@s/shared`
- ❌ Reading `$app.stage` — accept `stage` as a parameter instead
- ❌ Runtime AWS SDK calls (this package is deploy-time only)
- ❌ New exports that leak Pulumi types at the public surface without a wrapper
