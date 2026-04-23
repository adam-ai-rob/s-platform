/**
 * s-authz module stack.
 *
 * Mirrors the resources the root `infra/s-authz.ts` creates, but with
 * three shape changes that make this deployable as a stand-alone SST app:
 *
 * 1. **Platform primitives come from SSM, not imports.** The platform
 *    gateway id, event bus name/ARN, and alarms topic ARN are published
 *    by the `platform/` app to `/s-platform/{stage}/*` and read here via
 *    `readSsmOutput(...)` at the top of `buildStack()`.
 *
 * 2. **API Gateway route registration is raw Pulumi.** The gateway is
 *    owned by another SST app, so we can't call the SST sugar
 *    `gateway.route(...)`. We create an `aws.apigatewayv2.Integration`
 *    + `aws.apigatewayv2.Route` against the imported gateway id and a
 *    matching `aws.lambda.Permission` so APIGW can invoke the Lambda.
 *
 * 3. **Cross-app IAM is declared explicitly.** SST's `link: [...]`
 *    helper only grants IAM for resources owned by this app. For the
 *    platform-owned event bus we set `events:PutEvents` on the bus ARN
 *    and pass `EVENT_BUS_NAME` as an env var. Same pattern for the
 *    cross-module `AUTHZ_VIEW_TABLE_NAME` published downstream.
 *
 * The module also publishes its AuthzView table name + ARN to SSM so
 * every other module's API Lambda can pick them up as env vars +
 * IAM-policy resources at deploy time.
 */

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {
  allowEventBridgeToDlq,
  createDlqWithAlarm,
  readSsmOutput,
  writeSsmOutput,
} from "@s/infra-shared";

export async function buildStack() {
  const stage = $app.stage;

  // ─── Platform primitives (from SSM) ─────────────────────────────────────────

  const [gatewayId, gatewayUrl, eventBusName, eventBusArn, alarmsTopicArn] = await Promise.all([
    readSsmOutput("gateway-id", stage),
    readSsmOutput("gateway-url", stage),
    readSsmOutput("event-bus-name", stage),
    readSsmOutput("event-bus-arn", stage),
    readSsmOutput("alarms-topic-arn", stage),
  ]);

  // Account id + region are needed to compose the API Gateway invocation
  // source ARN that scopes the Lambda permission. Both are invokes, so
  // await them once at the top.
  const [caller, regionResult] = await Promise.all([aws.getCallerIdentity({}), aws.getRegion({})]);
  const accountId = caller.accountId;
  const region = regionResult.name;

  // ─── Tables ────────────────────────────────────────────────────────────────

  const authzRolesTable = new sst.aws.Dynamo("AuthzRoles", {
    fields: { id: "string", name: "string" },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByName: { hashKey: "name" },
    },
    stream: "new-and-old-images",
  });

  const authzUserRolesTable = new sst.aws.Dynamo("AuthzUserRoles", {
    fields: {
      id: "string",
      userId: "string",
      roleId: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByUserId: { hashKey: "userId" },
      ByRoleId: { hashKey: "roleId" },
    },
    stream: "new-and-old-images",
  });

  const authzGroupRolesTable = new sst.aws.Dynamo("AuthzGroupRoles", {
    fields: {
      id: "string",
      groupId: "string",
      roleId: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByGroupId: { hashKey: "groupId" },
      ByRoleId: { hashKey: "roleId" },
    },
    stream: "new-and-old-images",
  });

  const authzViewTable = new sst.aws.Dynamo("AuthzView", {
    fields: { userId: "string" },
    primaryIndex: { hashKey: "userId" },
    stream: "new-and-old-images",
  });

  // ─── API Lambda ────────────────────────────────────────────────────────────

  const authzApi = new sst.aws.Function("AuthzApi", {
    link: [authzRolesTable, authzUserRolesTable, authzGroupRolesTable, authzViewTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authz",
      AUTHN_URL: gatewayUrl,
      AUTHZ_ROLES_TABLE_NAME: authzRolesTable.name,
      AUTHZ_USER_ROLES_TABLE_NAME: authzUserRolesTable.name,
      AUTHZ_GROUP_ROLES_TABLE_NAME: authzGroupRolesTable.name,
      AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      // Cross-app: platform-owned event bus. link: [] can't reach it.
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-authz/functions/src/handler.handler",
  });

  // ─── API Gateway route (raw Pulumi — gateway owned by platform/) ───────────

  const authzIntegration = new aws.apigatewayv2.Integration("AuthzIntegration", {
    apiId: gatewayId,
    integrationType: "AWS_PROXY",
    integrationUri: authzApi.arn,
    // APIGW HTTP API AWS_PROXY integrations must use POST regardless of
    // the incoming method — the method is surfaced to the Lambda via
    // event.requestContext.http.method.
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("AuthzRoute", {
    apiId: gatewayId,
    routeKey: "ANY /authz/{proxy+}",
    target: pulumi.interpolate`integrations/${authzIntegration.id}`,
  });

  // Let APIGW invoke this Lambda. sourceArn scopes to `/authz/*` paths
  // on the imported gateway; other modules' routes can't accidentally
  // gain permission to call this handler. The IAM `*` wildcard matches
  // across `/` so this covers `/authz/foo/bar/baz` as well as `/authz/x`.
  new aws.lambda.Permission("AuthzInvokePermission", {
    action: "lambda:InvokeFunction",
    function: authzApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${gatewayId}/*/*/authz/*`,
  });

  // ─── Stream handler (roles + view streams) ─────────────────────────────────

  const authzStreamDlq = createDlqWithAlarm("AuthzStream", { alarmsTopicArn, stage });

  const authzStreamHandler = new sst.aws.Function("AuthzStreamHandler", {
    link: [authzRolesTable, authzViewTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authz-stream",
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      {
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [authzRolesTable.nodes.table.streamArn, authzViewTable.nodes.table.streamArn],
      },
      {
        actions: ["dynamodb:ListStreams"],
        resources: ["*"],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [authzStreamDlq.arn],
      },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-authz/functions/src/stream-handler.handler",
  });

  new aws.lambda.EventSourceMapping("AuthzRolesStreamMapping", {
    eventSourceArn: authzRolesTable.nodes.table.streamArn,
    functionName: authzStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: authzStreamDlq.arn },
    },
  });

  new aws.lambda.EventSourceMapping("AuthzViewStreamMapping", {
    eventSourceArn: authzViewTable.nodes.table.streamArn,
    functionName: authzStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: authzStreamDlq.arn },
    },
  });

  // ─── Event handler (user.* and group.* → rebuild AuthzView) ────────────────

  const authzEventHandler = new sst.aws.Function("AuthzEventHandler", {
    link: [authzRolesTable, authzUserRolesTable, authzGroupRolesTable, authzViewTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authz-events",
      AUTHZ_ROLES_TABLE_NAME: authzRolesTable.name,
      AUTHZ_USER_ROLES_TABLE_NAME: authzUserRolesTable.name,
      AUTHZ_GROUP_ROLES_TABLE_NAME: authzGroupRolesTable.name,
      AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
    },
    handler: "../../packages/s-authz/functions/src/event-handler.handler",
  });

  const authzSubscriptionsRule = new aws.cloudwatch.EventRule("AuthzSubscriptions", {
    eventBusName,
    eventPattern: JSON.stringify({
      source: ["s-authn", "s-group"],
      "detail-type": [
        "user.registered",
        "user.enabled",
        "user.disabled",
        "group.user.activated",
        "group.user.deactivated",
      ],
    }),
  });

  const authzEventDlq = createDlqWithAlarm("AuthzEvent", { alarmsTopicArn, stage });
  allowEventBridgeToDlq("AuthzEvent", authzEventDlq);

  new aws.cloudwatch.EventTarget("AuthzSubscriptionsTarget", {
    rule: authzSubscriptionsRule.name,
    eventBusName,
    arn: authzEventHandler.nodes.function.arn,
    deadLetterConfig: { arn: authzEventDlq.arn },
  });

  new aws.lambda.Permission("AuthzEventHandlerInvoke", {
    action: "lambda:InvokeFunction",
    function: authzEventHandler.nodes.function.name,
    principal: "events.amazonaws.com",
    sourceArn: authzSubscriptionsRule.arn,
  });

  // ─── Seed Lambda (invoked manually — idempotent system-role seeding) ──────

  const authzSeeds = new sst.aws.Function("AuthzSeeds", {
    link: [authzRolesTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-authz-seeds",
      AUTHZ_ROLES_TABLE_NAME: authzRolesTable.name,
    },
    timeout: "1 minute",
    handler: "../../packages/s-authz/functions/src/seed.handler",
  });

  // ─── Publish module outputs to SSM ─────────────────────────────────────────

  writeSsmOutput("SsmAuthzViewTableName", "authz-view-table-name", stage, {
    value: authzViewTable.name,
    description:
      "s-authz AuthzView DynamoDB table name (env var for every other module's API Lambda)",
  });
  writeSsmOutput("SsmAuthzViewTableArn", "authz-view-table-arn", stage, {
    value: authzViewTable.arn,
    description:
      "s-authz AuthzView DynamoDB table ARN (IAM resource for every other module's API Lambda)",
  });

  return {
    authzRolesTable: authzRolesTable.name,
    authzViewTable: authzViewTable.name,
    authzViewTableArn: authzViewTable.arn,
    authzApiArn: authzApi.arn,
    authzSeedsArn: authzSeeds.arn,
  };
}
