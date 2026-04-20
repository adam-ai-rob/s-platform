/**
 * Publish platform outputs to SSM Parameter Store under
 * `/s-platform/{stage}/*`. Module SST apps read these at deploy time
 * (`readSsmOutput(...)`) to wire themselves against the shared gateway,
 * bus, KMS key, and alarms topic.
 *
 * Keys (consumed by module SST apps):
 *   gateway-id              → module routes attach to this gateway
 *   gateway-url             → used to build AUTHN_URL for JWKS verification
 *   gateway-exec-role-arn   → future: when cross-account invocation is used
 *   event-bus-name          → module EventBridge rules + PutEvents
 *   event-bus-arn           → module IAM policies + subscriptions
 *   jwt-signing-key-arn     → s-authn KMS Sign/GetPublicKey policy
 *   jwt-signing-key-alias   → s-authn env var (KMS_KEY_ALIAS)
 *   alarms-topic-arn        → passed into createDlqWithAlarm from modules
 */

import type * as aws from "@pulumi/aws";
import { writeSsmOutput } from "@s/infra-shared";

export interface PlatformOutputs {
  gateway: sst.aws.ApiGatewayV2;
  eventBus: sst.aws.Bus;
  jwtSigningKey: aws.kms.Key;
  jwtSigningKeyAlias: aws.kms.Alias;
  alarmsTopic: aws.sns.Topic;
}

export function publish(outputs: PlatformOutputs): void {
  const stage = $app.stage;

  writeSsmOutput("SsmGatewayId", "gateway-id", stage, {
    value: outputs.gateway.nodes.api.id,
    description: "Platform API Gateway v2 id",
  });
  writeSsmOutput("SsmGatewayUrl", "gateway-url", stage, {
    value: outputs.gateway.url,
    description: "Platform API Gateway v2 invoke URL (custom domain if configured, else default)",
  });
  writeSsmOutput("SsmGatewayExecRoleArn", "gateway-exec-role-arn", stage, {
    // The execution-role ARN is currently not exposed by sst.aws.ApiGatewayV2
    // as a top-level output. Publish the gateway ARN as a placeholder; a
    // follow-up PR will switch this to the actual exec-role ARN when a
    // module needs cross-account invocation.
    value: outputs.gateway.nodes.api.arn,
    description: "Platform API Gateway v2 ARN (placeholder for exec-role ARN; see ssm-outputs.ts)",
  });

  writeSsmOutput("SsmEventBusName", "event-bus-name", stage, {
    value: outputs.eventBus.name,
    description: "Platform EventBridge bus name",
  });
  writeSsmOutput("SsmEventBusArn", "event-bus-arn", stage, {
    value: outputs.eventBus.arn,
    description: "Platform EventBridge bus ARN",
  });

  writeSsmOutput("SsmJwtSigningKeyArn", "jwt-signing-key-arn", stage, {
    value: outputs.jwtSigningKey.arn,
    description: "s-authn JWT signing key ARN (KMS RSA-4096)",
  });
  writeSsmOutput("SsmJwtSigningKeyAlias", "jwt-signing-key-alias", stage, {
    value: outputs.jwtSigningKeyAlias.name,
    description: "s-authn JWT signing key alias (alias/s-authn-jwt-{stage})",
  });

  writeSsmOutput("SsmAlarmsTopicArn", "alarms-topic-arn", stage, {
    value: outputs.alarmsTopic.arn,
    description: "Platform SNS alarms topic ARN",
  });
}
