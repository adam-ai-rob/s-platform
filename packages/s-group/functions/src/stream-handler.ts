import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { Group } from "@s-group/core/groups/groups.entity";
import type { GroupUser } from "@s-group/core/memberships/memberships.entity";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

/**
 * Stream handler:
 * - Groups stream → group.{created,updated,deleted}
 * - GroupUsers stream → group.user.{activated,deactivated}
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      logger.error("❌ Group stream record failed", {
        errorCode: "STREAM_HANDLER_FAILED",
        eventId: record.eventID,
        message: (err as Error).message,
      });
      throw err;
    }
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  const arn = record.eventSourceARN ?? "";

  if (arn.includes("GroupUsers")) {
    await processGroupUserRecord(record);
    return;
  }

  if (arn.includes("Groups")) {
    await processGroupRecord(record);
  }
}

async function processGroupRecord(record: DynamoDBRecord): Promise<void> {
  const image = record.dynamodb?.NewImage ?? record.dynamodb?.OldImage;
  if (!image) return;
  // biome-ignore lint/suspicious/noExplicitAny: DDB unmarshall signature
  const group = unmarshall(image as any) as Group;

  const eventName =
    record.eventName === "INSERT"
      ? "group.created"
      : record.eventName === "REMOVE"
        ? "group.deleted"
        : "group.updated";

  await publishEvent({
    source: "s-group",
    eventName,
    payload: { groupId: group.id, name: group.name },
  });
}

async function processGroupUserRecord(record: DynamoDBRecord): Promise<void> {
  const newImage = record.dynamodb?.NewImage
    ? // biome-ignore lint/suspicious/noExplicitAny: DDB unmarshall signature
      (unmarshall(record.dynamodb.NewImage as any) as GroupUser)
    : undefined;
  const oldImage = record.dynamodb?.OldImage
    ? // biome-ignore lint/suspicious/noExplicitAny: DDB unmarshall signature
      (unmarshall(record.dynamodb.OldImage as any) as GroupUser)
    : undefined;

  if (record.eventName === "INSERT" && newImage) {
    await publishEvent({
      source: "s-group",
      eventName: "group.user.activated",
      payload: {
        userId: newImage.userId,
        groupId: newImage.groupId,
        rel: newImage.rel,
      },
    });
    return;
  }

  if (record.eventName === "REMOVE" && oldImage) {
    await publishEvent({
      source: "s-group",
      eventName: "group.user.deactivated",
      payload: {
        userId: oldImage.userId,
        groupId: oldImage.groupId,
        rel: oldImage.rel,
      },
    });
  }
}
