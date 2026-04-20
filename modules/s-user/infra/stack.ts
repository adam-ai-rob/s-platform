/**
 * s-user module stack.
 *
 * Mirrors the root `infra/s-user.ts` with the same standalone-app
 * adaptations documented in `modules/s-authz/infra/stack.ts`:
 * platform primitives come from SSM, the gateway route is raw Pulumi,
 * cross-app IAM is declared explicitly.
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

  const userProfilesTable = new sst.aws.Dynamo("UserProfiles", {
    fields: {
      userId: "string",
    },
    primaryIndex: { hashKey: "userId" },
    stream: "new-and-old-images",
  });

  // ─── API Lambda ────────────────────────────────────────────────────────────

  const userApi = new sst.aws.Function("UserApi", {
    link: [userProfilesTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-user",
      USER_PROFILES_TABLE_NAME: userProfilesTable.name,
      AUTHN_URL: gatewayUrl,
      AUTHZ_VIEW_TABLE_NAME: authzViewTableName,
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
      { actions: ["dynamodb:GetItem"], resources: [authzViewTableArn] },
    ],
    handler: "../../packages/s-user/functions/src/handler.handler",
  });

  // ─── API Gateway route (raw Pulumi — gateway owned by platform/) ───────────

  const userIntegration = new aws.apigatewayv2.Integration("UserIntegration", {
    apiId: gatewayId,
    integrationType: "AWS_PROXY",
    integrationUri: userApi.arn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("UserRoute", {
    apiId: gatewayId,
    routeKey: "ANY /user/{proxy+}",
    target: pulumi.interpolate`integrations/${userIntegration.id}`,
  });

  new aws.lambda.Permission("UserInvokePermission", {
    action: "lambda:InvokeFunction",
    function: userApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${gatewayId}/*/*/user/*`,
  });

  // ─── Stream handler ────────────────────────────────────────────────────────

  const userStreamDlq = createDlqWithAlarm("UserStream", { alarmsTopicArn, stage });

  const userStreamHandler = new sst.aws.Function("UserStreamHandler", {
    link: [userProfilesTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-user-stream",
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      {
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [userProfilesTable.nodes.table.streamArn],
      },
      {
        actions: ["dynamodb:ListStreams"],
        resources: ["*"],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [userStreamDlq.arn],
      },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-user/functions/src/stream-handler.handler",
  });

  new aws.lambda.EventSourceMapping("UserProfilesStreamMapping", {
    eventSourceArn: userProfilesTable.nodes.table.streamArn,
    functionName: userStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: userStreamDlq.arn },
    },
  });

  // ─── Event handler (user.registered → create profile) ──────────────────────

  const userEventHandler = new sst.aws.Function("UserEventHandler", {
    link: [userProfilesTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-user-events",
      USER_PROFILES_TABLE_NAME: userProfilesTable.name,
    },
    handler: "../../packages/s-user/functions/src/event-handler.handler",
  });

  const userRegisteredRule = new aws.cloudwatch.EventRule("UserOnUserRegistered", {
    eventBusName,
    eventPattern: JSON.stringify({
      source: ["s-authn"],
      "detail-type": ["user.registered"],
    }),
  });

  const userEventDlq = createDlqWithAlarm("UserEvent", { alarmsTopicArn, stage });
  allowEventBridgeToDlq("UserEvent", userEventDlq);

  new aws.cloudwatch.EventTarget("UserOnUserRegisteredTarget", {
    rule: userRegisteredRule.name,
    eventBusName,
    arn: userEventHandler.nodes.function.arn,
    deadLetterConfig: { arn: userEventDlq.arn },
  });

  new aws.lambda.Permission("UserEventHandlerInvoke", {
    action: "lambda:InvokeFunction",
    function: userEventHandler.nodes.function.name,
    principal: "events.amazonaws.com",
    sourceArn: userRegisteredRule.arn,
  });

  return {
    userProfilesTable: userProfilesTable.name,
    userApiArn: userApi.arn,
  };
}
