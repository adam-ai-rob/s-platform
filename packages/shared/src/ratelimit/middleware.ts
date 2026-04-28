import type { MiddlewareHandler } from "hono";
import { RateLimitError } from "../errors/domain-error";
import { incrementAndGet } from "./repository";

export interface RateLimitOptions {
  service: string;
  action: string;
  windowMs: number;
  limit: number;
}

/**
 * Rate limiting middleware for Hono.
 *
 * Uses the shared RateLimits DynamoDB table to track requests per client IP.
 * IP is extracted from the x-forwarded-for header (set by API Gateway).
 *
 * Responses on limit exceeded include standard headers:
 *   X-RateLimit-Limit
 *   X-RateLimit-Remaining
 *   X-RateLimit-Reset
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    // API Gateway puts the client IP in x-forwarded-for (first entry).
    // In local dev/tests, fallback to a placeholder.
    const forwardedFor = c.req.header("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0]?.trim() : "127.0.0.1";

    if (!ip) {
      // Should not happen with the fallback, but safety first.
      await next();
      return;
    }

    try {
      const result = await incrementAndGet({
        service: opts.service,
        action: opts.action,
        identifier: ip,
        windowMs: opts.windowMs,
        limit: opts.limit,
      });

      c.header("X-RateLimit-Limit", result.limit.toString());
      c.header("X-RateLimit-Remaining", Math.max(0, result.limit - result.current).toString());
      c.header("X-RateLimit-Reset", result.reset.toString());

      if (result.current > result.limit) {
        throw new RateLimitError();
      }
    } catch (err) {
      // If it's a RateLimitError, rethrow it.
      if (err instanceof RateLimitError) throw err;

      // If the table is missing or DDB fails, log and fail open (don't block traffic).
      // This is a safety measure for local dev or partial stack deploys.
      console.error("❌ Rate limiter failed", {
        message: (err as Error).message,
        service: opts.service,
        action: opts.action,
      });
    }

    await next();
  };
}
