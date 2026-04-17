/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-platform — root SST application.
 *
 * Each bounded-context module is defined in its own `infra/s-{module}.ts`
 * file and imported below. Shared resources (API Gateway, EventBridge bus,
 * KMS, custom domain) live in `infra/shared.ts`.
 *
 * Stages:
 *   dev   — auto-deployed from branch stage/dev
 *   test  — auto-deployed from branch stage/test
 *   prod  — auto-deployed from branch stage/prod (with manual approval)
 *   pr-{N}  — ephemeral per-PR stage
 *   {user} — personal dev stage via `sst dev`
 */
export default $config({
  app(input) {
    return {
      name: "s-platform",
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
    // Shared resources (API Gateway, EventBridge bus, custom domain, KMS keys)
    const shared = await import("./infra/shared");

    // Per-module stacks. Each adds routes to the shared gateway and
    // declares its own tables, Lambdas, event rules, etc.
    const authn = await import("./infra/s-authn");
    //
    // Uncomment as modules are added.
    //
    // const authz = await import("./infra/s-authz");
    // const user = await import("./infra/s-user");
    // const group = await import("./infra/s-group");

    return {
      api: shared.gateway.url,
      eventBus: shared.platformEventBus.name,
      authnUsersTable: authn.authnUsersTable.name,
      authnRefreshTokensTable: authn.authnRefreshTokensTable.name,
    };
  },
});
