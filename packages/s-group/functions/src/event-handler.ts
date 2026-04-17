import { autoAssignUserByEmail } from "@s-group/core/memberships/memberships.service";
import type { PlatformEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { EventBridgeEvent } from "aws-lambda";

interface UserRegisteredPayload {
  userId: string;
  email: string;
}

/**
 * On user.registered, check the user's email domain and auto-assign to
 * matching groups.
 */
export async function handler(
  event: EventBridgeEvent<string, PlatformEvent<UserRegisteredPayload>>,
): Promise<void> {
  const envelope = event.detail;
  const payload = envelope.payload;

  logger.info("📨 Event received", {
    eventName: envelope.eventName,
    userId: payload.userId,
  });

  try {
    if (envelope.eventName === "user.registered") {
      await autoAssignUserByEmail(payload.userId, payload.email);
    }
  } catch (err) {
    logger.error("❌ Group event handler failed", {
      eventName: envelope.eventName,
      message: (err as Error).message,
    });
    throw err;
  }
}
