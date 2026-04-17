import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AuthzRole } from "@s-authz/core/roles/roles.entity";
import type { AuthzViewEntry } from "@s-authz/core/view/view.entity";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

/**
 * Publishes events from the AuthzRoles and AuthzView streams.
 *
 * AuthzRoles     → authz.role.{created,updated,deleted}
 * AuthzView      → authz.view.rebuilt
 * AuthzUserRoles → internal only, no events
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      logger.error("❌ Authz stream record failed", {
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

  const newImage = record.dynamodb?.NewImage
    ? // biome-ignore lint/suspicious/noExplicitAny: DDB Record unmarshall
      unmarshall(record.dynamodb.NewImage as any)
    : undefined;
  const oldImage = record.dynamodb?.OldImage
    ? // biome-ignore lint/suspicious/noExplicitAny: DDB Record unmarshall
      unmarshall(record.dynamodb.OldImage as any)
    : undefined;

  if (arn.includes("AuthzRoles")) {
    const role = (newImage ?? oldImage) as AuthzRole | undefined;
    if (!role) return;
    const eventName =
      record.eventName === "INSERT"
        ? "authz.role.created"
        : record.eventName === "REMOVE"
          ? "authz.role.deleted"
          : "authz.role.updated";
    await publishEvent({
      source: "s-authz",
      eventName,
      payload: { roleId: role.id, name: role.name },
    });
    return;
  }

  if (arn.includes("AuthzView") && record.eventName !== "REMOVE" && newImage) {
    const view = newImage as AuthzViewEntry;
    await publishEvent({
      source: "s-authz",
      eventName: "authz.view.rebuilt",
      payload: {
        userId: view.userId,
        permissionCount: view.permissions.length,
      },
    });
  }
}
