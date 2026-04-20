/// <reference path="./.sst/platform/config.d.ts" />

/**
 * s-platform — Tier-1 platform SST app.
 *
 * Owns the primitives that must exist before any module SST app can boot:
 *   - API Gateway v2 (shared routing plane)
 *   - EventBridge custom bus + archive (shared event plane)
 *   - KMS RSA-4096 JWT signing key + alias (s-authn reads this)
 *   - SNS alarms topic + email subscription (every module's DLQ alarms publish here)
 *   - DNS record + cert (per-stage custom domain)
 *
 * Every output is published to SSM Parameter Store under
 * `/s-platform/{stage}/*` so each module SST app can pick up the ARNs
 * without a code-level import.
 *
 * Deploy first for a new stage. See
 * `docs/runbooks/fresh-stage-bootstrap.md`.
 *
 * NOTE (2026-04): this app is additive for now. The root `sst.config.ts`
 * at the repo root still owns these resources on the existing `dev`,
 * `test`, and `prod` stages. Deploy `platform/` only to NEW scratch stages
 * while follow-up PRs migrate each module off the root config. Cut-over of
 * the production stages happens in the final PR of Phase 3.
 */
export default $config({
  app(input) {
    return {
      name: "s-platform-platform",
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
    const kms = await import("./infra/kms");
    const bus = await import("./infra/event-bus");
    const alarms = await import("./infra/alarms");
    const gateway = await import("./infra/gateway");
    const outputs = await import("./infra/ssm-outputs");

    outputs.publish({
      gateway: gateway.gateway,
      eventBus: bus.platformEventBus,
      jwtSigningKey: kms.jwtSigningKey,
      jwtSigningKeyAlias: kms.jwtSigningKeyAlias,
      alarmsTopic: alarms.platformAlarmsTopic,
    });

    return {
      gatewayUrl: gateway.gateway.url,
      gatewayId: gateway.gateway.nodes.api.id,
      eventBusName: bus.platformEventBus.name,
      eventBusArn: bus.platformEventBus.arn,
      jwtSigningKeyArn: kms.jwtSigningKey.arn,
      jwtSigningKeyAlias: kms.jwtSigningKeyAlias.name,
      alarmsTopicArn: alarms.platformAlarmsTopic.arn,
    };
  },
});
