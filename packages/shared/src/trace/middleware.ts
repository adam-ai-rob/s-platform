import type { MiddlewareHandler } from "hono";
import { ulid } from "ulid";

/**
 * W3C traceparent middleware.
 *
 * Extracts trace context from the incoming `traceparent` header, or
 * generates a fresh one. Sets `traceId`, `spanId`, and `traceparent`
 * on the Hono context so downstream middleware and handlers can
 * include them in logs and outbound calls.
 *
 * Format: `00-<trace-id>-<span-id>-<trace-flags>`
 *   - trace-id: 32 hex chars
 *   - span-id: 16 hex chars
 *   - trace-flags: `01` = sampled, `00` = not sampled
 */

export type TraceEnv = {
  Variables: {
    traceId: string;
    spanId: string;
    traceparent: string;
  };
};

function generateTraceId(): string {
  // 32 hex chars — derived from a ULID to keep monotonic ordering for logs
  return ulid().toLowerCase().padEnd(32, "0").slice(0, 32);
}

function generateSpanId(): string {
  // 16 hex chars
  return ulid().toLowerCase().padEnd(16, "0").slice(0, 16);
}

export function traceMiddleware(): MiddlewareHandler<TraceEnv> {
  return async (c, next) => {
    const incoming = c.req.header("traceparent");
    let traceId: string;
    const spanId = generateSpanId();

    if (incoming && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(incoming)) {
      const parts = incoming.split("-");
      traceId = parts[1] ?? generateTraceId();
    } else {
      traceId = generateTraceId();
    }

    c.set("traceId", traceId);
    c.set("spanId", spanId);
    c.set("traceparent", `00-${traceId}-${spanId}-01`);

    await next();
  };
}
