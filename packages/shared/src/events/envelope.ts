/**
 * Platform Event envelope — published on EventBridge for all cross-module events.
 *
 * Naming: `{domain}.{entity}.{past-tense-verb}` (e.g., `user.registered`).
 *
 * Fields:
 *   - eventName: identifies the event type (routing key for consumers)
 *   - correlationId: ULID, stable across retries — use for idempotency
 *   - traceId: W3C trace ID from the originating request
 *   - occurredAt: when the domain event happened (not when published)
 *   - payload: event-specific data (typed per event)
 */

export interface PlatformEvent<T = unknown> {
  eventName: string;
  correlationId: string;
  traceId: string;
  occurredAt: string;
  payload: T;
}
