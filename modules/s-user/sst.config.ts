/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-user — Tier-2 module SST app.
 *
 * Owns the UserProfiles DDB table, the API Lambda for `/user/*`, the
 * stream handler that publishes `user.profile.created` /
 * `user.profile.updated`, and the event handler that subscribes to
 * `user.registered` from s-authn to provision an empty profile.
 *
 * Reads from SSM at deploy time: the platform primitives (gateway id,
 * gateway url, event bus name/ARN, alarms topic ARN) plus s-authz's
 * `authz-view-table-{name,arn}` keys. Bootstrap order:
 * `platform → s-authz → this module`.
 */
export default $config({
  app(input) {
    return {
      name: "s-module-user",
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
