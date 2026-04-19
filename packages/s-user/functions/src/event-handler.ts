import { handleUserRegistered } from "@s-user/core/profiles/profiles.service";
import type { PlatformEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";
import type { EventBridgeEvent } from "aws-lambda";

interface UserRegisteredPayload {
  userId: string;
  email: string;
  occurredAt?: string;
}

/**
 * EventBridge handler — subscribes to s-authn events.
 *
 * Currently only processes `user.registered`. DLQ wiring on the Lambda
 * catches anything that fails after Lambda retries.
 */
export async function handler(
  event: EventBridgeEvent<string, PlatformEvent<UserRegisteredPayload>>,
): Promise<void> {
  const envelope = event.detail;
  logger.info("📨 Event received", {
    eventName: envelope.eventName,
    correlationId: envelope.correlationId,
    traceId: envelope.traceId,
  });

  try {
    switch (envelope.eventName) {
      case "user.registered":
        await handleUserRegistered(envelope.payload);
        break;
      default:
        logger.debug("Unhandled event", { eventName: envelope.eventName });
    }
  } catch (err) {
    logger.error("❌ Event handler failed", {
      eventName: envelope.eventName,
      correlationId: envelope.correlationId,
      message: (err as Error).message,
    });
    throw err; // Let Lambda retry / DLQ
  }
}
