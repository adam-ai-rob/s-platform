/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-group — Tier-2 module SST app.
 *
 * Owns Groups + GroupUsers DDB tables, the API Lambda for `/group/*`,
 * the stream handler that publishes `group.user.activated` /
 * `group.user.deactivated` / `group.created` / `group.updated`, and the
 * event handler that subscribes to `user.registered` for email-domain
 * auto-assignment.
 *
 * Reads from SSM at deploy time: platform primitives + s-authz's
 * `authz-view-table-{name,arn}`. Bootstrap order:
 * `platform → s-authz → this module`.
 */
export default $config({
  app(input) {
    return {
      name: "s-module-group",
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
