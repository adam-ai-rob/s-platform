/**
 * @s/infra-shared
 *
 * Infrastructure helpers consumed by the `platform/` SST app and every
 * `modules/s-{name}/` SST app. Kept separate from `@s/shared` because
 * that package lands inside every module's runtime Lambda bundle — these
 * helpers depend on `@pulumi/aws` and must never be shipped to Lambda.
 *
 * Two concerns:
 *   - DLQ + alarm wiring (moved verbatim from the old `infra/shared.ts`)
 *   - SSM Parameter Store pub/sub used to stitch platform + module SST
 *     apps together at deploy time without a code-level import across apps
 */

import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";

// ─── DLQ + Alarm helpers ──────────────────────────────────────────────────────

export interface DlqBundle {
  queue: aws.sqs.Queue;
  arn: pulumi.Output<string>;
}

export interface DlqOptions {
  /** ARN of the SNS topic that receives the "DLQ not empty" alarm. */
  alarmsTopicArn: pulumi.Input<string>;
  /** Deploy stage, used to suffix resource names (e.g. `dev`, `pr-42`). */
  stage: string;
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
 * pair with `allowEventBridgeToDlq()` so the event-bus service principal can
 * write to the queue.
 */
export function createDlqWithAlarm(name: string, opts: DlqOptions): DlqBundle {
  const queue = new aws.sqs.Queue(`${name}Dlq`, {
    name: `${name}-dlq-${opts.stage}`,
    messageRetentionSeconds: 1_209_600, // 14 days
  });

  new aws.cloudwatch.MetricAlarm(`${name}DlqAlarm`, {
    name: `${name}-dlq-not-empty-${opts.stage}`,
    alarmDescription: `${name} DLQ has at least one message — handler failed past its retry budget`,
    namespace: "AWS/SQS",
    metricName: "ApproximateNumberOfMessagesVisible",
    statistic: "Maximum",
    period: 60,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    dimensions: { QueueName: queue.name },
    alarmActions: [opts.alarmsTopicArn],
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

// ─── SSM Parameter Store: cross-app output plumbing ───────────────────────────

/**
 * Build the canonical SSM parameter prefix for a given stage.
 * Every platform- or module-published output lives under this path so that
 * `aws ssm get-parameters-by-path --path /s-platform/{stage}` enumerates
 * the whole inter-app contract for a stage.
 */
export function ssmPrefix(stage: string): string {
  return `/s-platform/${stage}`;
}

export interface SsmOutputOptions {
  /** Value to store. Can be a string or a Pulumi Output resolved at deploy. */
  value: pulumi.Input<string>;
  /** Human-readable description; shows up in the AWS console. */
  description?: string;
}

/**
 * Publish an output value under the canonical `/s-platform/{stage}/{key}`
 * SSM prefix. Used by the `platform/` app to hand off gateway/bus/KMS ARNs
 * to each module, and by `s-authz` to hand off the AuthzView table name to
 * every other module.
 *
 * `overwrite: true` is intentional — redeploys of an app must replace their
 * own outputs in place; we never want the deploy to fail because the param
 * already exists from a prior deploy.
 */
export function writeSsmOutput(
  logicalName: string,
  key: string,
  stage: string,
  opts: SsmOutputOptions,
): aws.ssm.Parameter {
  return new aws.ssm.Parameter(logicalName, {
    name: `${ssmPrefix(stage)}/${key}`,
    type: "String",
    value: opts.value,
    description: opts.description,
    overwrite: true,
  });
}

/**
 * Read a previously-published SSM String parameter at deploy time.
 * Awaitable; return value is the plain string value. Use inside a module
 * SST app's `async run()` to look up the platform-owned gateway id, event
 * bus ARN, KMS key ARN, or another module's published outputs.
 *
 * Throws if the parameter does not exist — deploy order enforces that the
 * producer (`platform/` or `s-authz`) runs before any consumer.
 */
export async function readSsmOutput(key: string, stage: string): Promise<string> {
  const result = await aws.ssm.getParameter({
    name: `${ssmPrefix(stage)}/${key}`,
    withDecryption: false,
  });
  return result.value;
}
