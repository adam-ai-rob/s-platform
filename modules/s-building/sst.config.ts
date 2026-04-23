/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-building — Tier-2 module SST app.
 *
 * Owns the `Buildings` DDB table + the API Lambda for `/building/*`.
 * Stream-handler, event-handler, search-indexer, and backfill Lambdas
 * land in later sub-issues (#67 for events, #68 for Typesense) — this
 * scaffold deploys the API surface on its own so /building/health,
 * /info, /openapi.json, and /docs are live end-to-end after the first
 * deploy.
 *
 * Reads from SSM at deploy time: platform primitives (gateway id,
 * gateway url, event bus name/ARN, alarms topic ARN) plus s-authz's
 * `authz-view-table-{name,arn}` keys. Bootstrap order:
 * `platform → s-authz → this module` (run the AuthzSeeds Lambda in
 * between to provision the building system roles — see
 * `docs/runbooks/fresh-stage-bootstrap.md`).
 */
export default $config({
  app(input) {
    return {
      name: "s-module-building",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "eu-west-1",
          profile: process.env.CI ? undefined : "itinn-bot",
        },
      },
    };
  },
  async run() {
    const { buildStack } = await import("./infra/stack");
    return await buildStack();
  },
});
