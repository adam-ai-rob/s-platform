import * as aws from "@pulumi/aws";
import { gateway, platformEventBus } from "./shared";

/**
 * s-user infrastructure:
 * - UserProfiles DynamoDB table with streams
 * - API Lambda (Hono handler for /user/*)
 * - Stream handler (publishes user.profile.created/updated to EventBridge)
 * - Event handler (subscribes to user.registered from s-authn)
 */

export const userProfilesTable = new sst.aws.Dynamo("UserProfiles", {
  fields: {
    userId: "string",
  },
  primaryIndex: { hashKey: "userId" },
  stream: "new-and-old-images",
});

// ─── API Lambda ───────────────────────────────────────────────────────────────

export const userApi = new sst.aws.Function("UserApi", {
  link: [userProfilesTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-user",
    USER_PROFILES_TABLE_NAME: userProfilesTable.name,
    AUTHN_URL: gateway.url, // for authMiddleware JWKS
  },
  handler: "packages/s-user/functions/src/handler.handler",
});

gateway.route("ANY /user/{proxy+}", userApi.arn);

// ─── Stream Handler ───────────────────────────────────────────────────────────

export const userStreamHandler = new sst.aws.Function("UserStreamHandler", {
  link: [userProfilesTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-user-stream",
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
  ],
  handler: "packages/s-user/functions/src/stream-handler.handler",
});

new aws.lambda.EventSourceMapping("UserProfilesStreamMapping", {
  eventSourceArn: userProfilesTable.nodes.table.streamArn,
  functionName: userStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
});

// ─── Event Handler (user.registered → create profile) ─────────────────────────

export const userEventHandler = new sst.aws.Function("UserEventHandler", {
  link: [userProfilesTable],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-user-events",
    USER_PROFILES_TABLE_NAME: userProfilesTable.name,
  },
  handler: "packages/s-user/functions/src/event-handler.handler",
});

const userRegisteredRule = new aws.cloudwatch.EventRule("UserOnUserRegistered", {
  eventBusName: platformEventBus.name,
  eventPattern: JSON.stringify({
    source: ["s-authn"],
    "detail-type": ["user.registered"],
  }),
});

new aws.cloudwatch.EventTarget("UserOnUserRegisteredTarget", {
  rule: userRegisteredRule.name,
  eventBusName: platformEventBus.name,
  arn: userEventHandler.nodes.function.arn,
});

new aws.lambda.Permission("UserEventHandlerInvoke", {
  action: "lambda:InvokeFunction",
  function: userEventHandler.nodes.function.name,
  principal: "events.amazonaws.com",
  sourceArn: userRegisteredRule.arn,
});
