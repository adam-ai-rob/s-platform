import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ulid } from "ulid";
import type { ZodType } from "zod";
import { logger } from "../logger/logger";
import type { PlatformEvent } from "./envelope";

/**
 * EventBridge publish helper.
 *
 * Called from stream handlers (DDB Streams → EventBridge) when a DB
 * write should produce a platform event. The EventBridge bus name
 * must be available as EVENT_BUS_NAME env var (set via SST link).
 *
 * Publish is fire-and-forget from the handler's perspective; if the
 * PutEvents call fails, the Lambda throws, Lambda retries via the
 * stream event source mapping.
 */

let client: EventBridgeClient | null = null;

function getClient(): EventBridgeClient {
  if (!client) {
    client = new EventBridgeClient({
      region: process.env.AWS_REGION ?? "eu-west-1",
    });
  }
  return client;
}

/**
 * Test-only: swap the EventBridge client singleton so tests can assert
 * on `send` calls without standing up a real EventBridge. Mirrors the
 * pattern in `@s/shared/search` (`__setClientsForTests`).
 */
export function __setEventBridgeClientForTests(override: EventBridgeClient): void {
  client = override;
}

export function __resetEventBridgeClientForTests(): void {
  client = null;
}

export interface PublishEventParams<T = unknown> {
  eventName: string;
  source: string; // module name, e.g. "s-authn"
  payload: T;
  /**
   * Optional Zod schema for the payload. When supplied, the payload is
   * parsed against the schema before PutEvents — a failure throws an
   * Error with a descriptive message (the producer Lambda will retry).
   * Producers pass the same schema that their AsyncAPI doc advertises
   * so published events are guaranteed to match their declared contract.
   */
  schema?: ZodType<T>;
  correlationId?: string;
  traceId?: string;
  occurredAt?: string;
}

export async function publishEvent<T = unknown>(params: PublishEventParams<T>): Promise<void> {
  const busName = process.env.EVENT_BUS_NAME;
  if (!busName) {
    throw new Error("EVENT_BUS_NAME env var not set — is the Lambda linked to platformEventBus?");
  }

  if (params.schema) {
    const result = params.schema.safeParse(params.payload);
    if (!result.success) {
      logger.error("❌ Event payload failed schema validation", {
        errorCode: "EVENT_SCHEMA_VIOLATION",
        eventName: params.eventName,
        issues: result.error.issues,
      });
      throw new Error(
        `Event ${params.eventName} payload did not match its declared schema: ${result.error.message}`,
      );
    }
  }

  const envelope: PlatformEvent<T> = {
    eventName: params.eventName,
    correlationId: params.correlationId ?? ulid(),
    traceId: params.traceId ?? ulid(),
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    payload: params.payload,
  };

  const res = await getClient().send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: params.source,
          DetailType: params.eventName,
          Detail: JSON.stringify(envelope),
        },
      ],
    }),
  );

  if (res.FailedEntryCount && res.FailedEntryCount > 0) {
    logger.error("❌ EventBridge publish failed", {
      errorCode: "EVENT_PUBLISH_FAILED",
      eventName: params.eventName,
      correlationId: envelope.correlationId,
      failures: res.Entries,
    });
    throw new Error(`EventBridge PutEvents failed for ${params.eventName}`);
  }

  logger.info("📤 Event published", {
    eventName: params.eventName,
    correlationId: envelope.correlationId,
    traceId: envelope.traceId,
  });
}
