/**
 * s-group module stack.
 *
 * Mirrors the root `infra/s-group.ts` with the standalone-app
 * adaptations documented in `modules/s-authz/infra/stack.ts`.
 *
 * Only cross-module read is the AuthzView — `AUTHZ_VIEW_TABLE_NAME`
 * env var + `dynamodb:GetItem` permission on its ARN, both resolved
 * from SSM keys published by s-authz.
 */

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { allowEventBridgeToDlq, createDlqWithAlarm, readSsmOutput } from "@s/infra-shared";

export async function buildStack() {
  const stage = $app.stage;

  const [
    gatewayId,
    gatewayUrl,
    eventBusName,
    eventBusArn,
    alarmsTopicArn,
    authzViewTableName,
    authzViewTableArn,
  ] = await Promise.all([
    readSsmOutput("gateway-id", stage),
    readSsmOutput("gateway-url", stage),
    readSsmOutput("event-bus-name", stage),
    readSsmOutput("event-bus-arn", stage),
    readSsmOutput("alarms-topic-arn", stage),
    readSsmOutput("authz-view-table-name", stage),
    readSsmOutput("authz-view-table-arn", stage),
  ]);

  const [caller, regionResult] = await Promise.all([aws.getCallerIdentity({}), aws.getRegion({})]);
  const accountId = caller.accountId;
  const region = regionResult.name;

  // ─── Tables ────────────────────────────────────────────────────────────────

  const groupsTable = new sst.aws.Dynamo("Groups", {
    fields: {
      id: "string",
      name: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByName: { hashKey: "name" },
    },
    stream: "new-and-old-images",
  });

  const groupUsersTable = new sst.aws.Dynamo("GroupUsers", {
    fields: {
      id: "string",
      groupId: "string",
      userId: "string",
    },
    primaryIndex: { hashKey: "id" },
    globalIndexes: {
      ByGroupId: { hashKey: "groupId" },
      ByUserId: { hashKey: "userId" },
    },
    stream: "new-and-old-images",
  });

  // ─── API Lambda ────────────────────────────────────────────────────────────

  const groupApi = new sst.aws.Function("GroupApi", {
    link: [groupsTable, groupUsersTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-group",
      AUTHN_URL: gatewayUrl,
      GROUPS_TABLE_NAME: groupsTable.name,
      GROUP_USERS_TABLE_NAME: groupUsersTable.name,
      AUTHZ_VIEW_TABLE_NAME: authzViewTableName,
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
      { actions: ["dynamodb:GetItem"], resources: [authzViewTableArn] },
    ],
    handler: "../../packages/s-group/functions/src/handler.handler",
  });

  // ─── API Gateway route (raw Pulumi — gateway owned by platform/) ───────────

  const groupIntegration = new aws.apigatewayv2.Integration("GroupIntegration", {
    apiId: gatewayId,
    integrationType: "AWS_PROXY",
    integrationUri: groupApi.arn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("GroupRoute", {
    apiId: gatewayId,
    routeKey: "ANY /group/{proxy+}",
    target: pulumi.interpolate`integrations/${groupIntegration.id}`,
  });

  new aws.lambda.Permission("GroupInvokePermission", {
    action: "lambda:InvokeFunction",
    function: groupApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${gatewayId}/*/*/group/*`,
  });

  // ─── Stream handler (Groups + GroupUsers) ──────────────────────────────────

  const groupStreamDlq = createDlqWithAlarm("GroupStream", { alarmsTopicArn, stage });

  const groupStreamHandler = new sst.aws.Function("GroupStreamHandler", {
    link: [groupsTable, groupUsersTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-group-stream",
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      {
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [groupsTable.nodes.table.streamArn, groupUsersTable.nodes.table.streamArn],
      },
      {
        actions: ["dynamodb:ListStreams"],
        resources: ["*"],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [groupStreamDlq.arn],
      },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-group/functions/src/stream-handler.handler",
  });

  new aws.lambda.EventSourceMapping("GroupsStreamMapping", {
    eventSourceArn: groupsTable.nodes.table.streamArn,
    functionName: groupStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: groupStreamDlq.arn },
    },
  });

  new aws.lambda.EventSourceMapping("GroupUsersStreamMapping", {
    eventSourceArn: groupUsersTable.nodes.table.streamArn,
    functionName: groupStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: groupStreamDlq.arn },
    },
  });

  // ─── Event handler (user.registered → domain auto-assign) ──────────────────

  const groupEventHandler = new sst.aws.Function("GroupEventHandler", {
    link: [groupsTable, groupUsersTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-group-events",
      GROUPS_TABLE_NAME: groupsTable.name,
      GROUP_USERS_TABLE_NAME: groupUsersTable.name,
    },
    handler: "../../packages/s-group/functions/src/event-handler.handler",
  });

  const groupOnUserRegisteredRule = new aws.cloudwatch.EventRule("GroupOnUserRegistered", {
    eventBusName,
    eventPattern: JSON.stringify({
      source: ["s-authn"],
      "detail-type": ["user.registered"],
    }),
  });

  const groupEventDlq = createDlqWithAlarm("GroupEvent", { alarmsTopicArn, stage });
  allowEventBridgeToDlq("GroupEvent", groupEventDlq);

  new aws.cloudwatch.EventTarget("GroupOnUserRegisteredTarget", {
    rule: groupOnUserRegisteredRule.name,
    eventBusName,
    arn: groupEventHandler.nodes.function.arn,
    deadLetterConfig: { arn: groupEventDlq.arn },
  });

  new aws.lambda.Permission("GroupEventHandlerInvoke", {
    action: "lambda:InvokeFunction",
    function: groupEventHandler.nodes.function.name,
    principal: "events.amazonaws.com",
    sourceArn: groupOnUserRegisteredRule.arn,
  });

  return {
    groupsTable: groupsTable.name,
    groupUsersTable: groupUsersTable.name,
    groupApiArn: groupApi.arn,
  };
}
