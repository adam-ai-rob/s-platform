import { unmarshall } from "@aws-sdk/util-dynamodb";
import { userEventCatalog } from "@s-user/core/events";
import type { UserProfile } from "@s-user/core/profiles/profiles.entity";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

/**
 * Emits `user.profile.created` / `user.profile.updated` from DDB Streams.
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      logger.error("❌ Stream record failed", {
        errorCode: "STREAM_HANDLER_FAILED",
        eventId: record.eventID,
        message: (err as Error).message,
      });
      throw err;
    }
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") return;

  const newImage = record.dynamodb?.NewImage
    ? (unmarshall(
        // biome-ignore lint/suspicious/noExplicitAny: DDB Record type mismatch with unmarshall
        record.dynamodb.NewImage as any,
      ) as UserProfile)
    : undefined;

  if (!newImage) return;

  const eventName = record.eventName === "INSERT" ? "user.profile.created" : "user.profile.updated";

  await publishEvent({
    source: "s-user",
    eventName,
    schema: userEventCatalog[eventName].schema,
    payload: {
      userId: newImage.userId,
      firstName: newImage.firstName,
      lastName: newImage.lastName,
    },
  });
}
