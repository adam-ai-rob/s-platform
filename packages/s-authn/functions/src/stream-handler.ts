import { unmarshall } from "@aws-sdk/util-dynamodb";
import { authnEventCatalog } from "@s-authn/core/events";
import type { AuthnUser } from "@s-authn/core/users/users.entity";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

/**
 * DynamoDB Streams handler for s-authn.
 *
 * Reads changes to AuthnUsers and publishes platform events to EventBridge.
 * The DB write is the source of truth; this handler is a CDC relay.
 *
 * Events emitted:
 *   INSERT                          → user.registered
 *   MODIFY: enabled false → true    → user.enabled
 *   MODIFY: enabled true → false    → user.disabled
 *   MODIFY: passwordHash changed    → user.password.changed
 *
 * Idempotency: handlers on the receiving side must be idempotent because
 * Lambda may retry on failure. Each event carries a correlationId to
 * support short-circuiting duplicates downstream.
 *
 * Refresh-token table changes are NOT emitted — those are internal.
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
      throw err; // let Lambda retry
    }
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  const arn = record.eventSourceARN ?? "";

  // Only handle AuthnUsers stream events in this handler.
  // AuthnRefreshTokens stream events are internal and not emitted.
  if (!arn.includes("AuthnUsers")) return;

  const newImage = record.dynamodb?.NewImage
    ? (unmarshall(
        // biome-ignore lint/suspicious/noExplicitAny: DDB Record type mismatch with unmarshall
        record.dynamodb.NewImage as any,
      ) as AuthnUser)
    : undefined;
  const oldImage = record.dynamodb?.OldImage
    ? (unmarshall(
        // biome-ignore lint/suspicious/noExplicitAny: DDB Record type mismatch with unmarshall
        record.dynamodb.OldImage as any,
      ) as AuthnUser)
    : undefined;

  if (record.eventName === "INSERT" && newImage) {
    await publishEvent({
      source: "s-authn",
      eventName: "user.registered",
      schema: authnEventCatalog["user.registered"].schema,
      payload: {
        userId: newImage.id,
        email: newImage.email,
        occurredAt: newImage.createdAt,
      },
    });
    return;
  }

  if (record.eventName === "MODIFY" && newImage && oldImage) {
    if (!oldImage.enabled && newImage.enabled) {
      await publishEvent({
        source: "s-authn",
        eventName: "user.enabled",
        schema: authnEventCatalog["user.enabled"].schema,
        payload: { userId: newImage.id },
      });
    }
    if (oldImage.enabled && !newImage.enabled) {
      await publishEvent({
        source: "s-authn",
        eventName: "user.disabled",
        schema: authnEventCatalog["user.disabled"].schema,
        payload: { userId: newImage.id },
      });
    }
    if (oldImage.passwordHash !== newImage.passwordHash && newImage.passwordHash) {
      await publishEvent({
        source: "s-authn",
        eventName: "user.password.changed",
        schema: authnEventCatalog["user.password.changed"].schema,
        payload: { userId: newImage.id },
      });
    }
  }
}
