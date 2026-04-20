/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-authz — Tier-2 module SST app.
 *
 * Owns the module's DDB tables (AuthzRoles, AuthzUserRoles, AuthzGroupRoles,
 * AuthzView), its API Lambda, stream handler, and event handler. Deploys
 * independently of every other module.
 *
 * Platform primitives (gateway id, event bus, alarms topic) come in via
 * SSM parameters published by the `platform/` app — see
 * `docs/runbooks/fresh-stage-bootstrap.md` for the deploy order.
 *
 * Also publishes to SSM on deploy:
 *   /s-platform/{stage}/authz-view-table-name
 *   /s-platform/{stage}/authz-view-table-arn
 * Every other module's API Lambda reads these at deploy time to wire up
 * its auth-middleware read path into the AuthzView, replacing the old
 * code-level `import { authzViewTable } from "./s-authz"` pattern.
 */
export default $config({
  app(input) {
    return {
      name: "s-module-authz",
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
