/**
 * Idempotency helpers for event handlers.
 *
 * DynamoDB Streams and EventBridge both provide at-least-once delivery.
 * Every event handler MUST be idempotent. Three strategies:
 *
 * 1. Natural idempotency — overwriting a denormalized view. Re-running
 *    produces the same result. Preferred.
 *
 * 2. Conditional insert — use `attribute_not_exists(pk)` condition on
 *    put(). Catch ConditionalCheckFailedException as "already done."
 *
 * 3. Correlation ID tracking — store each processed correlationId in a
 *    dedicated table with a TTL. Use when neither (1) nor (2) applies.
 *
 * Services should prefer (1) or (2). Use (3) only when you genuinely
 * need to short-circuit an expensive side effect on replay.
 *
 * This file provides the building blocks for (3). Actual ProcessedEvents
 * table is declared in infra/shared.ts once we need it — not included in
 * the scaffold to avoid unused infra.
 */

export interface MarkProcessedOptions {
  ttlSeconds?: number; // default 3600 (1 hour)
}

/**
 * Placeholder — wire up to a real table in follow-up work.
 *
 *   const processed = await markProcessed(event.correlationId);
 *   if (!processed) return; // duplicate
 */
export async function markProcessed(
  _correlationId: string,
  _options: MarkProcessedOptions = {},
): Promise<boolean> {
  throw new Error(
    "markProcessed not yet implemented — provision ProcessedEvents table in infra/shared.ts first",
  );
}
