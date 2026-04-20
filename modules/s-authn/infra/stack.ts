/**
 * s-authn module stack.
 *
 * Mirrors the root `infra/s-authn.ts` resources, with the same three
 * standalone-app adaptations documented in `modules/s-authz/infra/stack.ts`
 * plus one authn-specific concern:
 *
 *   - **KMS sign/verify policy.** s-authn needs `kms:Sign` +
 *     `kms:GetPublicKey` on the platform-owned JWT signing key. The key
 *     ARN comes from SSM (`jwt-signing-key-arn`); we declare the grant
 *     via the `sst.aws.Function` `permissions` helper rather than a
 *     separate `aws.iam.Policy` + `RolePolicyAttachment` because the
 *     key is external but scoped to exactly this Lambda.
 *
 *   - **Read from the platform AuthzView.** `AUTHZ_VIEW_TABLE_NAME`
 *     comes in from the s-authz SSM output; we grant `dynamodb:GetItem`
 *     on its ARN so the auth middleware can resolve permissions.
 *
 *   - **argon2 native module.** `@node-rs/argon2` ships prebuilt `.node`
 *     binaries per platform. SST's Lambda bundler must install the
 *     `linux-x64-gnu` subpackage explicitly so local (macOS) installs
 *     don't skip it as an optional cross-platform dep. This mirrors the
 *     root config exactly.
 */

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { createDlqWithAlarm, readSsmOutput } from "@s/infra-shared";

export async function buildStack() {
  const stage = $app.stage;

  const [
    gatewayId,
    gatewayUrl,
    eventBusName,
    eventBusArn,
    alarmsTopicArn,
    jwtSigningKeyArn,
    jwtSigningKeyAlias,
    authzViewTableName,
    authzViewTableArn,
  ] = await Promise.all([
    readSsmOutput("gateway-id", stage),
    readSsmOutput("gateway-url", stage),
    readSsmOutput("event-bus-name", stage),
    readSsmOutput("event-bus-arn", stage),
    readSsmOutput("alarms-topic-arn", stage),
    readSsmOutput("jwt-signing-key-arn", stage),
    readSsmOutput("jwt-signing-key-alias", stage),
    readSsmOutput("authz-view-table-name", stage),
    readSsmOutput("authz-view-table-arn", stage),
  ]);

  const [caller, regionResult] = await Promise.all([aws.getCallerIdentity({}), aws.getRegion({})]);
  const accountId = caller.accountId;
  const region = regionResult.name;

  // ─── Tables ────────────────────────────────────────────────────────────────

  const authnUsersTable = new sst.aws.Dynamo("AuthnUsers", {
    fields: {
      id: "string",
      email: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByEmail: { hashKey: "email" },
    },
    stream: "new-and-old-images",
  });

  const authnRefreshTokensTable = new sst.aws.Dynamo("AuthnRefreshTokens", {
    fields: {
      id: "string",
      userId: "string",
      createdAt: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByUserId: { hashKey: "userId", rangeKey: "createdAt" },
    },
    ttl: "expiresAtEpoch",
    stream: "new-and-old-images",
  });

  // ─── API Lambda ────────────────────────────────────────────────────────────

  const authnApi = new sst.aws.Function("AuthnApi", {
    link: [authnUsersTable, authnRefreshTokensTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authn",
      KMS_KEY_ALIAS: jwtSigningKeyAlias,
      JWT_ISSUER: "s-authn",
      JWT_AUDIENCE: "s-platform",
      AUTHN_URL: gatewayUrl,
      AUTHN_USERS_TABLE_NAME: authnUsersTable.name,
      AUTHN_REFRESH_TOKENS_TABLE_NAME: authnRefreshTokensTable.name,
      AUTHZ_VIEW_TABLE_NAME: authzViewTableName,
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      { actions: ["kms:Sign", "kms:GetPublicKey"], resources: [jwtSigningKeyArn] },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
      { actions: ["dynamodb:GetItem"], resources: [authzViewTableArn] },
    ],
    handler: "../../packages/s-authn/functions/src/handler.handler",
    nodejs: {
      // Preserve root-config nuance: @node-rs/argon2 ships prebuilt .node
      // binaries per platform — don't let esbuild try to bundle them.
      // Include the linux-x64-gnu subpackage explicitly so macOS installs
      // don't skip it as an optional cross-platform dep.
      install: ["@node-rs/argon2", "@node-rs/argon2-linux-x64-gnu"],
    },
  });

  // ─── API Gateway route (raw Pulumi — gateway owned by platform/) ───────────

  const authnIntegration = new aws.apigatewayv2.Integration("AuthnIntegration", {
    apiId: gatewayId,
    integrationType: "AWS_PROXY",
    integrationUri: authnApi.arn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("AuthnRoute", {
    apiId: gatewayId,
    routeKey: "ANY /authn/{proxy+}",
    target: pulumi.interpolate`integrations/${authnIntegration.id}`,
  });

  new aws.lambda.Permission("AuthnInvokePermission", {
    action: "lambda:InvokeFunction",
    function: authnApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${gatewayId}/*/*/authn/*`,
  });

  // ─── Stream handler (AuthnUsers only — refresh tokens don't publish) ───────

  const authnStreamDlq = createDlqWithAlarm("AuthnStream", { alarmsTopicArn, stage });

  const authnStreamHandler = new sst.aws.Function("AuthnStreamHandler", {
    link: [authnUsersTable, authnRefreshTokensTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authn-stream",
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      {
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [authnUsersTable.nodes.table.streamArn],
      },
      {
        actions: ["dynamodb:ListStreams"],
        resources: ["*"],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [authnStreamDlq.arn],
      },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-authn/functions/src/stream-handler.handler",
  });

  new aws.lambda.EventSourceMapping("AuthnUsersStreamMapping", {
    eventSourceArn: authnUsersTable.nodes.table.streamArn,
    functionName: authnStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: authnStreamDlq.arn },
    },
  });

  return {
    authnUsersTable: authnUsersTable.name,
    authnRefreshTokensTable: authnRefreshTokensTable.name,
    authnApiArn: authnApi.arn,
  };
}
