import * as aws from "@pulumi/aws";
import { allowEventBridgeToDlq, createDlqWithAlarm, gateway, platformEventBus } from "./shared";

/**
 * s-authz infrastructure:
 * - AuthzRoles, AuthzUserRoles, AuthzGroupRoles, AuthzView tables
 * - API Lambda (admin + user routes)
 * - Stream handler (role + view streams → EventBridge)
 * - Event handler (subscribes to user- and group-lifecycle events)
 */

export const authzRolesTable = new sst.aws.Dynamo("AuthzRoles", {
  fields: { id: "string", name: "string" },
  primaryIndex: { hashKey: "id" },
  globalIndexes: {
    ByName: { hashKey: "name" },
  },
  stream: "new-and-old-images",
});

export const authzUserRolesTable = new sst.aws.Dynamo("AuthzUserRoles", {
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

export const authzGroupRolesTable = new sst.aws.Dynamo("AuthzGroupRoles", {
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

/**
 * AuthzView — flat permissions per user. Every other module's
 * auth middleware reads this via the shared repository, so the table
 * name is exported as AUTHZ_VIEW_TABLE_NAME env var into each API Lambda.
 */
export const authzViewTable = new sst.aws.Dynamo("AuthzView", {
  fields: { userId: "string" },
  primaryIndex: { hashKey: "userId" },
  stream: "new-and-old-images",
});

// ─── API Lambda ───────────────────────────────────────────────────────────────

export const authzApi = new sst.aws.Function("AuthzApi", {
  link: [
    authzRolesTable,
    authzUserRolesTable,
    authzGroupRolesTable,
    authzViewTable,
    platformEventBus,
  ],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-authz",
    AUTHN_URL: gateway.url,
    AUTHZ_ROLES_TABLE_NAME: authzRolesTable.name,
    AUTHZ_USER_ROLES_TABLE_NAME: authzUserRolesTable.name,
    AUTHZ_GROUP_ROLES_TABLE_NAME: authzGroupRolesTable.name,
    AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
  },
  handler: "packages/s-authz/functions/src/handler.handler",
});

gateway.route("ANY /authz/{proxy+}", authzApi.arn);

// ─── Stream handler (roles + view streams) ────────────────────────────────────

const authzStreamDlq = createDlqWithAlarm("AuthzStream");

export const authzStreamHandler = new sst.aws.Function("AuthzStreamHandler", {
  link: [authzRolesTable, authzViewTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-authz-stream",
    EVENT_BUS_NAME: platformEventBus.name,
  },
  permissions: [
    {
      actions: [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams",
      ],
      resources: ["*"],
    },
    {
      actions: ["sqs:SendMessage"],
      resources: [authzStreamDlq.arn],
    },
  ],
  handler: "packages/s-authz/functions/src/stream-handler.handler",
});

new aws.lambda.EventSourceMapping("AuthzRolesStreamMapping", {
  eventSourceArn: authzRolesTable.nodes.table.streamArn,
  functionName: authzStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
  destinationConfig: {
    onFailure: { destination: authzStreamDlq.arn },
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
    onFailure: { destination: authzStreamDlq.arn },
  },
});

// ─── Event handler (user.* and group.* events → rebuild view) ─────────────────

export const authzEventHandler = new sst.aws.Function("AuthzEventHandler", {
  link: [authzRolesTable, authzUserRolesTable, authzGroupRolesTable, authzViewTable],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-authz-events",
    AUTHZ_ROLES_TABLE_NAME: authzRolesTable.name,
    AUTHZ_USER_ROLES_TABLE_NAME: authzUserRolesTable.name,
    AUTHZ_GROUP_ROLES_TABLE_NAME: authzGroupRolesTable.name,
    AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
  },
  handler: "packages/s-authz/functions/src/event-handler.handler",
});

const authzSubscriptionsRule = new aws.cloudwatch.EventRule("AuthzSubscriptions", {
  eventBusName: platformEventBus.name,
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

const authzEventDlq = createDlqWithAlarm("AuthzEvent");
allowEventBridgeToDlq("AuthzEvent", authzEventDlq);

new aws.cloudwatch.EventTarget("AuthzSubscriptionsTarget", {
  rule: authzSubscriptionsRule.name,
  eventBusName: platformEventBus.name,
  arn: authzEventHandler.nodes.function.arn,
  deadLetterConfig: { arn: authzEventDlq.arn },
});

new aws.lambda.Permission("AuthzEventHandlerInvoke", {
  action: "lambda:InvokeFunction",
  function: authzEventHandler.nodes.function.name,
  principal: "events.amazonaws.com",
  sourceArn: authzSubscriptionsRule.arn,
});
