/**
 * Shared infrastructure across all modules.
 *
 * - PlatformGateway — single API Gateway v2 (HTTP API) fronting all module Lambdas
 * - PlatformEventBus — custom EventBridge bus for cross-module events
 * - JwtSigningKey — KMS RSA-4096 key used by s-authn to sign JWTs
 * - (Custom domain when stage has one)
 *
 * Each per-module infra file (`infra/s-{module}.ts`) imports these
 * resources and attaches routes, rules, and IAM policies.
 */

import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";
import { getDomainConfig } from "./domains";

// ─── KMS: JWT Signing Key (RSA-4096) ──────────────────────────────────────────

export const jwtSigningKey = new aws.kms.Key("JwtSigningKey", {
  description: `s-authn JWT signing key (${$app.stage})`,
  keyUsage: "SIGN_VERIFY",
  customerMasterKeySpec: "RSA_4096",
  deletionWindowInDays: $app.stage === "prod" ? 30 : 7,
  enableKeyRotation: false, // RSA signing keys don't auto-rotate
});

export const jwtSigningKeyAlias = new aws.kms.Alias("JwtSigningKeyAlias", {
  name: `alias/s-authn-jwt-${$app.stage}`,
  targetKeyId: jwtSigningKey.keyId,
});

// ─── EventBridge: Platform Event Bus ──────────────────────────────────────────

export const platformEventBus = new sst.aws.Bus("PlatformEventBus", {
  // Custom bus name per stage
  // Modules subscribe via EventBridge rules in their own stack files
});

// Optional: archive for replay (90 days)
new aws.cloudwatch.EventArchive("PlatformEventArchive", {
  name: `platform-events-archive-${$app.stage}`,
  eventSourceArn: platformEventBus.arn,
  retentionDays: 90,
  description: "Archive for replay of platform events",
});

// ─── API Gateway: Shared HTTP API ─────────────────────────────────────────────

const domain = getDomainConfig();

export const gateway = new sst.aws.ApiGatewayV2("PlatformGateway", {
  cors: {
    // Wildcard origin is intentional. Auth is JWT bearer in Authorization header,
    // not cookies. `credentials: false` (implicit) is required for wildcard.
    // Do not change without coordinating with the team.
    allowOrigins: ["*"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Traceparent", "X-Location"],
  },
  ...(domain && {
    domain: {
      name: domain.apiDomain,
      // sst.aws.dns() with no args auto-resolves the hosted zone by
      // suffix-matching the domain name. `s-api.smartiqi.com` is the
      // closest zone match for dev/test/prod.s-api.smartiqi.com and
      // the apex. Passing an explicit zoneId/zoneName caused "no
      // matching zone found" in SST's internal getZone invocation.
      dns: sst.aws.dns(),
    },
  }),
});

// Public /health (catch-all across modules — each module's Lambda provides its own)
// NOTE: individual modules add their own `GET /{module}/health` via routes in their stack.
// A platform-level /health is optional; omit for now to keep routing clean.

// OPTIONS /{proxy+} — CORS preflight for all routes, no auth
// gateway-level CORS handles this, but keeping as explicit route is a belt-and-suspenders choice.

// ─── SNS: Platform Alarms ─────────────────────────────────────────────────────

/**
 * Single topic that fans out every CloudWatch alarm across the platform.
 * Subscribed via email for now; add Slack/PagerDuty by subscribing additional
 * endpoints (tracked as a follow-up).
 *
 * Note: SNS email subscriptions are `PendingConfirmation` until the recipient
 * clicks the confirmation link. Expect a one-time email per stage on first
 * deploy.
 */
export const platformAlarmsTopic = new aws.sns.Topic("PlatformAlarms", {
  name: `platform-alarms-${$app.stage}`,
  displayName: `s-platform alarms (${$app.stage})`,
});

new aws.sns.TopicSubscription("PlatformAlarmsEmail", {
  topic: platformAlarmsTopic.arn,
  protocol: "email",
  endpoint: "robert.hikl@outlook.com",
});

// ─── DLQ Helpers ──────────────────────────────────────────────────────────────

export interface DlqBundle {
  queue: aws.sqs.Queue;
  arn: pulumi.Output<string>;
}

/**
 * Create a DLQ + CloudWatch alarm pair. Alarm fires when at least one message
 * sits in the DLQ (indicating a handler failed past its retry budget) and
 * publishes to the platform alarms SNS topic.
 *
 * For DDB-stream consumers, wire via `EventSourceMapping.destinationConfig`
 * and grant the Lambda `sqs:SendMessage` on the DLQ ARN.
 *
 * For EventBridge targets, wire via `EventTarget.deadLetterConfig.arn` and
 * add a `QueuePolicy` allowing `events.amazonaws.com` to send messages.
 */
export function createDlqWithAlarm(name: string): DlqBundle {
  const queue = new aws.sqs.Queue(`${name}Dlq`, {
    name: `${name}-dlq-${$app.stage}`,
    messageRetentionSeconds: 1_209_600, // 14 days
  });

  new aws.cloudwatch.MetricAlarm(`${name}DlqAlarm`, {
    name: `${name}-dlq-not-empty-${$app.stage}`,
    alarmDescription: `${name} DLQ has at least one message — handler failed past its retry budget`,
    namespace: "AWS/SQS",
    metricName: "ApproximateNumberOfMessagesVisible",
    statistic: "Maximum",
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    dimensions: { QueueName: queue.name },
    alarmActions: [platformAlarmsTopic.arn],
    treatMissingData: "notBreaching",
  });

  return { queue, arn: queue.arn };
}

/**
 * Grant EventBridge the right to SendMessage to a DLQ. Use for DLQs wired
 * onto `EventTarget.deadLetterConfig.arn`.
 */
export function allowEventBridgeToDlq(name: string, dlq: DlqBundle): void {
  new aws.sqs.QueuePolicy(`${name}DlqPolicy`, {
    queueUrl: dlq.queue.id,
    policy: dlq.queue.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "events.amazonaws.com" },
            Action: "sqs:SendMessage",
            Resource: arn,
          },
        ],
      }),
    ),
  });
}
