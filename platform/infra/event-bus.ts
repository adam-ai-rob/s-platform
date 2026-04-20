/**
 * Platform EventBridge — shared custom bus + 90-day archive.
 *
 * Every module publishes domain events to this bus and subscribes via
 * `aws.cloudwatch.EventRule` + `EventTarget` declared in its own SST app.
 *
 * The bus name + ARN are published to SSM (`ssm-outputs.ts`) so module
 * apps can reference them without importing this file.
 */

import * as aws from "@pulumi/aws";

export const platformEventBus = new sst.aws.Bus("PlatformEventBus", {
  // Custom bus name per stage. Modules subscribe via EventBridge rules
  // in their own SST app files.
});

new aws.cloudwatch.EventArchive("PlatformEventArchive", {
  name: `platform-events-archive-${$app.stage}`,
  eventSourceArn: platformEventBus.arn,
  retentionDays: 90,
  description: "Archive for replay of platform events",
});
