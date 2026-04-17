import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { authzViewTable } from "./s-authz";
import { createDlqWithAlarm, gateway, jwtSigningKeyAlias, platformEventBus } from "./shared";

/**
 * s-authn infrastructure:
 * - AuthnUsers + AuthnRefreshTokens DynamoDB tables
 * - API Lambda (Hono handler for /authn/*)
 * - Stream handler Lambda (DDB Streams → EventBridge)
 * - KMS Sign/GetPublicKey permissions on the jwt signing key
 * - Routes on the shared PlatformGateway
 */

// ─── DynamoDB Tables ──────────────────────────────────────────────────────────

export const authnUsersTable = new sst.aws.Dynamo("AuthnUsers", {
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

export const authnRefreshTokensTable = new sst.aws.Dynamo("AuthnRefreshTokens", {
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

// ─── API Lambda ───────────────────────────────────────────────────────────────

export const authnApi = new sst.aws.Function("AuthnApi", {
  link: [authnUsersTable, authnRefreshTokensTable, authzViewTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-authn",
    KMS_KEY_ALIAS: jwtSigningKeyAlias.name,
    JWT_ISSUER: "s-authn",
    JWT_AUDIENCE: "s-platform",
    AUTHN_URL: gateway.url, // for @s/shared/auth JWKS self-reference
    AUTHN_USERS_TABLE_NAME: authnUsersTable.name,
    AUTHN_REFRESH_TOKENS_TABLE_NAME: authnRefreshTokensTable.name,
    AUTHZ_VIEW_TABLE_NAME: authzViewTable.name,
  },
  handler: "packages/s-authn/functions/src/handler.handler",
  nodejs: {
    // @node-rs/argon2 ships prebuilt .node binaries per platform — don't let
    // esbuild try to bundle them. Installed fresh at build time for Lambda's
    // linux-x64-gnu runtime.
    install: ["@node-rs/argon2"],
  },
});

// Grant KMS Sign + GetPublicKey
const authnKmsPolicy = new aws.iam.Policy("AuthnApiKmsPolicy", {
  policy: jwtSigningKeyAlias.targetKeyId.apply((_keyId) =>
    pulumi.all([jwtSigningKeyAlias.arn]).apply(([_aliasArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Action: ["kms:Sign", "kms:GetPublicKey"],
            Effect: "Allow",
            Resource: "*", // aliases don't work directly as resource; production narrows to key ARN
          },
        ],
      }),
    ),
  ),
});

new aws.iam.RolePolicyAttachment("AuthnApiKmsAttach", {
  role: authnApi.nodes.role.name,
  policyArn: authnKmsPolicy.arn,
});

// Mount routes on the shared gateway: ANY /authn/{proxy+}
gateway.route("ANY /authn/{proxy+}", authnApi.arn);

// ─── Stream Handler Lambda ────────────────────────────────────────────────────

const authnStreamDlq = createDlqWithAlarm("AuthnStream");

export const authnStreamHandler = new sst.aws.Function("AuthnStreamHandler", {
  link: [authnUsersTable, authnRefreshTokensTable, platformEventBus],
  environment: {
    STAGE: $app.stage,
    SERVICE_NAME: "s-authn-stream",
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
      resources: [authnStreamDlq.arn],
    },
  ],
  handler: "packages/s-authn/functions/src/stream-handler.handler",
});

new aws.lambda.EventSourceMapping("AuthnUsersStreamMapping", {
  eventSourceArn: authnUsersTable.nodes.table.streamArn,
  functionName: authnStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
  destinationConfig: {
    onFailure: { destination: authnStreamDlq.arn },
  },
});
