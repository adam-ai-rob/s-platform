/**
 * Platform alarms — a single SNS topic that fans out every CloudWatch
 * alarm across the platform. Subscribed via email for now; add Slack /
 * PagerDuty by subscribing additional endpoints.
 *
 * Every module's DLQ alarms publish here (via `createDlqWithAlarm` from
 * `@s/infra-shared`, with the topic ARN passed in from SSM).
 *
 * Note: SNS email subscriptions are `PendingConfirmation` until the
 * recipient clicks the confirmation link. Expect a one-time email per
 * stage on first deploy.
 */

import * as aws from "@pulumi/aws";

export const platformAlarmsTopic = new aws.sns.Topic("PlatformAlarms", {
  name: `platform-alarms-${$app.stage}`,
  displayName: `s-platform alarms (${$app.stage})`,
});

new aws.sns.TopicSubscription("PlatformAlarmsEmail", {
  topic: platformAlarmsTopic.arn,
  protocol: "email",
  endpoint: "robert.hikl@outlook.com",
});
