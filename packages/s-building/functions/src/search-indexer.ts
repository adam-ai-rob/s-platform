import { buildingsRepository } from "@s-building/core/buildings/buildings.repository";
import { deleteBuildingFromIndex, indexBuilding } from "@s-building/core/search/buildings.indexer";
import type { PlatformEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { EventBridgeEvent } from "aws-lambda";

/**
 * EventBridge subscriber that keeps the Typesense `buildings` collection
 * in sync with DDB Buildings.
 *
 * Listens for (matches the EventRule pattern in `modules/s-building/infra`):
 *   - building.created   → read from DDB, upsert
 *   - building.updated   → read from DDB, upsert
 *   - building.activated → read from DDB, upsert (status field changed)
 *   - building.archived  → read from DDB, upsert (status field changed)
 *   - building.deleted   → delete document by buildingId
 *
 * Events carry only identity; the full row is fetched from DDB because
 * it's the source of truth. Two free correctness properties same as the
 * s-user indexer:
 *
 *   1. Out-of-order events are safe — we re-read current state each time.
 *   2. Race against concurrent delete is safe — a missing row on upsert
 *      path is skipped silently; the tombstone event cleans up.
 *
 * Activated / archived collapse into the same "re-read and upsert" path
 * because the DDB row already reflects the new status — no need for
 * a separate side-effect here.
 */

interface BuildingEventPayload {
  buildingId: string;
  status?: string;
}

type UpsertEvent =
  | "building.created"
  | "building.updated"
  | "building.activated"
  | "building.archived";
type DeleteEvent = "building.deleted";
type SupportedEvent = UpsertEvent | DeleteEvent;

export async function handler(
  event: EventBridgeEvent<string, PlatformEvent<BuildingEventPayload>>,
): Promise<void> {
  const envelope = event.detail;
  logger.info("📨 Indexer event received", {
    eventName: envelope.eventName,
    correlationId: envelope.correlationId,
  });

  try {
    switch (envelope.eventName as SupportedEvent) {
      case "building.created":
      case "building.updated":
      case "building.activated":
      case "building.archived": {
        const building = await buildingsRepository.findById(envelope.payload.buildingId);
        if (!building) {
          logger.info("Building not found on index upsert; skipping", {
            buildingId: envelope.payload.buildingId,
          });
          return;
        }
        await indexBuilding(building);
        break;
      }
      case "building.deleted":
        await deleteBuildingFromIndex(envelope.payload.buildingId);
        break;
      default:
        logger.debug("Unhandled event in indexer", { eventName: envelope.eventName });
    }
  } catch (err) {
    logger.error("❌ Indexer failed", {
      eventName: envelope.eventName,
      correlationId: envelope.correlationId,
      message: (err as Error).message,
    });
    throw err;
  }
}
