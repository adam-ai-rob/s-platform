import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Building } from "@s-building/core/buildings/buildings.entity";
import { buildingEventCatalog } from "@s-building/core/events";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { AttributeValue, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

/**
 * Publishes lifecycle events off the Buildings DDB stream.
 *
 *   INSERT                            → building.created
 *   MODIFY                            → building.updated
 *   MODIFY (status → active)          → + building.activated
 *   MODIFY (status → archived)        → + building.archived
 *   REMOVE                            → building.deleted
 *
 * Transition events are ADDITIVE to `building.updated`: on a status
 * flip, both the generic "updated" and the specific transition event
 * fire. Subscribers that only care about state changes can rule on the
 * specific event and ignore the generic one.
 *
 * Consumers fetch the full row from DDB when they need more than
 * identity — payloads are intentionally minimal so we don't lie about
 * field snapshots under retries.
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
  const newImage = unmarshallImage(record.dynamodb?.NewImage, "NewImage", record.eventID);
  const oldImage = unmarshallImage(record.dynamodb?.OldImage, "OldImage", record.eventID);

  for (const emit of diffRecord(record.eventName, newImage, oldImage)) {
    await publishEvent({
      source: "s-building",
      eventName: emit.eventName,
      schema: buildingEventCatalog[emit.eventName].schema,
      payload: emit.payload,
    });
  }
}

function unmarshallImage(
  image: { [key: string]: AttributeValue } | undefined,
  kind: "NewImage" | "OldImage",
  eventId: string | undefined,
): Building | undefined {
  if (!image) return undefined;
  // aws-lambda and @aws-sdk/util-dynamodb ship different AttributeValue
  // type definitions for the same wire format — known bridge. The
  // unmarshalled value is then validated through the Building Zod
  // schema so a corrupt row silently drops instead of emitting a
  // malformed event.
  // biome-ignore lint/suspicious/noExplicitAny: DDB Record type mismatch with unmarshall
  const raw = unmarshall(image as any);
  const parsed = Building.safeParse(raw);
  if (!parsed.success) {
    logger.warn("⚠️ Skipping malformed Buildings stream image", {
      kind,
      eventId,
      buildingId: typeof raw?.buildingId === "string" ? raw.buildingId : undefined,
      issues: parsed.error.issues,
    });
    return undefined;
  }
  return parsed.data;
}

/**
 * Pure function: given an event kind and the two images, return the
 * sequence of platform events to emit. Exported for unit tests so we
 * don't need a live stream to assert the transition matrix.
 */
export type EmittedEvent =
  | { eventName: "building.created"; payload: { buildingId: string; status: Building["status"] } }
  | { eventName: "building.updated"; payload: { buildingId: string } }
  | { eventName: "building.activated"; payload: { buildingId: string } }
  | { eventName: "building.archived"; payload: { buildingId: string } }
  | { eventName: "building.deleted"; payload: { buildingId: string } };

export function diffRecord(
  eventName: DynamoDBRecord["eventName"],
  newImage: Building | undefined,
  oldImage: Building | undefined,
): EmittedEvent[] {
  if (eventName === "INSERT" && newImage) {
    return [
      {
        eventName: "building.created",
        payload: { buildingId: newImage.buildingId, status: newImage.status },
      },
    ];
  }

  if (eventName === "MODIFY" && newImage && oldImage) {
    const out: EmittedEvent[] = [
      { eventName: "building.updated", payload: { buildingId: newImage.buildingId } },
    ];
    if (oldImage.status !== "active" && newImage.status === "active") {
      out.push({
        eventName: "building.activated",
        payload: { buildingId: newImage.buildingId },
      });
    }
    if (oldImage.status !== "archived" && newImage.status === "archived") {
      out.push({
        eventName: "building.archived",
        payload: { buildingId: newImage.buildingId },
      });
    }
    return out;
  }

  if (eventName === "REMOVE" && oldImage) {
    return [{ eventName: "building.deleted", payload: { buildingId: oldImage.buildingId } }];
  }

  return [];
}
