/**
 * s-building module stack.
 *
 * Mirrors `modules/s-user/infra/stack.ts` with the same standalone-app
 * adaptations: platform primitives come from SSM, the gateway route is
 * raw Pulumi, cross-app IAM is declared explicitly.
 *
 * Scope so far:
 *   - #65: API Lambda + DDB table + gateway wiring + Typesense SSM
 *   - #67: stream-handler Lambda + DLQ/alarm + EventSourceMapping
 *
 * Still to come: search-indexer + backfill Lambdas (#68).
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

  // SSM ARN patterns for Typesense secrets, resolved at runtime by every
  // Lambda in this module. The parameters themselves are operator-managed
  // (see docs/runbooks/typesense-stage-bootstrap.md) — not declared here.
  const typesenseParamArn = `arn:aws:ssm:${region}:${accountId}:parameter/s-platform/${stage}/typesense/*`;
  const typesenseSsmPermissions = [
    { actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [typesenseParamArn] },
    {
      actions: ["kms:Decrypt"],
      resources: [`arn:aws:kms:${region}:${accountId}:alias/aws/ssm`],
    },
  ];

  // ─── Tables ────────────────────────────────────────────────────────────────

  // Buildings — one row per building. `ByStatus` GSI gives us an
  // admin-fallback list path (by status, sorted by updatedAtMs) for when
  // Typesense is unavailable; day-to-day lists go through Typesense.
  // Streams enabled so #67's stream-handler can publish lifecycle events.
  const buildingsTable = new sst.aws.Dynamo("Buildings", {
    fields: {
      buildingId: "string",
      status: "string",
      updatedAtMs: "number",
    },
    primaryIndex: { hashKey: "buildingId" },
    globalIndexes: {
      ByStatus: { hashKey: "status", rangeKey: "updatedAtMs" },
    },
    stream: "new-and-old-images",
  });

  // ─── API Lambda ────────────────────────────────────────────────────────────

  const buildingApi = new sst.aws.Function("BuildingApi", {
    link: [buildingsTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-building",
      BUILDINGS_TABLE_NAME: buildingsTable.name,
      AUTHN_URL: gatewayUrl,
      AUTHZ_VIEW_TABLE_NAME: authzViewTableName,
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
      { actions: ["dynamodb:GetItem"], resources: [authzViewTableArn] },
      ...typesenseSsmPermissions,
    ],
    handler: "../../packages/s-building/functions/src/handler.handler",
  });

  // ─── API Gateway route (raw Pulumi — gateway owned by platform/) ───────────

  const buildingIntegration = new aws.apigatewayv2.Integration("BuildingIntegration", {
    apiId: gatewayId,
    integrationType: "AWS_PROXY",
    integrationUri: buildingApi.arn,
    integrationMethod: "POST",
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("BuildingRoute", {
    apiId: gatewayId,
    routeKey: "ANY /building/{proxy+}",
    target: pulumi.interpolate`integrations/${buildingIntegration.id}`,
  });

  new aws.lambda.Permission("BuildingInvokePermission", {
    action: "lambda:InvokeFunction",
    function: buildingApi.nodes.function.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: `arn:aws:execute-api:${region}:${accountId}:${gatewayId}/*/*/building/*`,
  });

  // ─── Stream handler (Buildings DDB → EventBridge) ─────────────────────────

  const buildingStreamDlq = createDlqWithAlarm("BuildingStream", { alarmsTopicArn, stage });

  const buildingStreamHandler = new sst.aws.Function("BuildingStreamHandler", {
    link: [buildingsTable],
    environment: {
      STAGE: stage,
      SERVICE_NAME: "s-building-stream",
      EVENT_BUS_NAME: eventBusName,
    },
    permissions: [
      {
        actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"],
        resources: [buildingsTable.nodes.table.streamArn],
      },
      {
        actions: ["dynamodb:ListStreams"],
        resources: ["*"],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [buildingStreamDlq.arn],
      },
      { actions: ["events:PutEvents"], resources: [eventBusArn] },
    ],
    handler: "../../packages/s-building/functions/src/stream-handler.handler",
  });

  new aws.lambda.EventSourceMapping("BuildingsStreamMapping", {
    eventSourceArn: buildingsTable.nodes.table.streamArn,
    functionName: buildingStreamHandler.nodes.function.arn,
    startingPosition: "LATEST",
    batchSize: 10,
    maximumRetryAttempts: 3,
    maximumRecordAgeInSeconds: 3600,
    destinationConfig: {
      onFailure: { destinationArn: buildingStreamDlq.arn },
    },
  });

  return {
    buildingsTable: buildingsTable.name,
    buildingApiArn: buildingApi.arn,
    buildingStreamHandlerArn: buildingStreamHandler.arn,
  };
}
