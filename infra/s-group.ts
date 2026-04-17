import * as aws from "@pulumi/aws";
import { authzViewTable } from "./s-authz";
import { gateway, platformEventBus } from "./shared";

/**
 * s-group infrastructure:
 * - Groups + GroupUsers tables with streams
 * - API Lambda
 * - Stream handler (emits group.* events)
 * - Event handler (subscribes to user.registered for domain auto-assign)
 *
 * Note: the API Lambda is linked to `authzViewTable` (from s-authz) so
 * `@s/shared/auth` middleware can read permissions. Same pattern as
 * every other module — the shared authz view is a platform singleton.
 */

export const groupsTable = new sst.aws.Dynamo("Groups", {
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

export const groupUsersTable = new sst.aws.Dynamo("GroupUsers", {
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

// ─── API Lambda ───────────────────────────────────────────────────────────────

export const groupApi = new sst.aws.Function("GroupApi", {
  link: [groupsTable, groupUsersTable, authzViewTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-group",
    AUTHN_URL: gateway.url,
    GROUPS_TABLE_NAME: groupsTable.name,
    GROUP_USERS_TABLE_NAME: groupUsersTable.name,
    AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
  },
  handler: "packages/s-group/functions/src/handler.handler",
});

gateway.route("ANY /group/{proxy+}", groupApi.arn);

// ─── Stream handler (Groups + GroupUsers) ─────────────────────────────────────

export const groupStreamHandler = new sst.aws.Function("GroupStreamHandler", {
  link: [platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-group-stream",
  },
  handler: "packages/s-group/functions/src/stream-handler.handler",
});

new aws.lambda.EventSourceMapping("GroupsStreamMapping", {
  eventSourceArn: groupsTable.nodes.table.streamArn,
  functionName: groupStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
});

new aws.lambda.EventSourceMapping("GroupUsersStreamMapping", {
  eventSourceArn: groupUsersTable.nodes.table.streamArn,
  functionName: groupStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
});

// ─── Event handler (user.registered → domain auto-assign) ─────────────────────

export const groupEventHandler = new sst.aws.Function("GroupEventHandler", {
  link: [groupsTable, groupUsersTable],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-group-events",
    GROUPS_TABLE_NAME: groupsTable.name,
    GROUP_USERS_TABLE_NAME: groupUsersTable.name,
  },
  handler: "packages/s-group/functions/src/event-handler.handler",
});

const groupOnUserRegisteredRule = new aws.cloudwatch.EventRule("GroupOnUserRegistered", {
  eventBusName: platformEventBus.name,
  eventPattern: JSON.stringify({
    source: ["s-authn"],
    "detail-type": ["user.registered"],
  }),
});

new aws.cloudwatch.EventTarget("GroupOnUserRegisteredTarget", {
  rule: groupOnUserRegisteredRule.name,
  eventBusName: platformEventBus.name,
  arn: groupEventHandler.nodes.function.arn,
});

new aws.lambda.Permission("GroupEventHandlerInvoke", {
  action: "lambda:InvokeFunction",
  function: groupEventHandler.nodes.function.name,
  principal: "events.amazonaws.com",
  sourceArn: groupOnUserRegisteredRule.arn,
});
