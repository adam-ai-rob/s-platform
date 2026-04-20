/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-authn — Tier-2 module SST app.
 *
 * Owns AuthnUsers + AuthnRefreshTokens DDB tables, the API Lambda that
 * handles `/authn/*`, the stream handler that publishes
 * `user.registered` / `user.enabled` / `user.disabled` /
 * `user.password.changed` events, and the IAM glue that lets the API
 * Lambda sign JWTs with the platform-owned KMS key.
 *
 * Reads from SSM at deploy time:
 *   - gateway-id, gateway-url, event-bus-name, event-bus-arn,
 *     alarms-topic-arn, jwt-signing-key-arn, jwt-signing-key-alias
 *     (published by `platform/`)
 *   - authz-view-table-name, authz-view-table-arn
 *     (published by `modules/s-authz/`)
 *
 * Bootstrap order for a fresh stage: platform → s-authz → this module.
 * See docs/runbooks/fresh-stage-bootstrap.md.
 */
export default $config({
  app(input) {
    return {
      name: "s-module-authn",
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
