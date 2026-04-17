import type { Context } from "hono";
import { ZodError } from "zod";
import { logger } from "../logger/logger";
import { DomainError } from "./domain-error";

type AnyContext = Context<{ Variables: { traceId?: string; user?: { userId?: string } } }>;

/**
 * Global error handler for OpenAPIHono apps.
 *
 * Catches DomainError, ZodError, and unknown errors, producing a
 * consistent `{ error: { code, message, details } }` response.
 *
 * Registered automatically by createApi() in @s/shared/http.
 */
export function globalErrorHandler(err: Error, c: AnyContext): Response {
  const traceId = c.get("traceId");
  const userId = c.get("user")?.userId;

  if (err instanceof DomainError) {
    if (err.statusCode >= 500) {
      logger.error(`❌ ${err.message}`, {
        errorCode: err.code,
        statusCode: err.statusCode,
        stack: err.stack,
        traceId,
        userId,
      });
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        },
      },
      err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues,
        },
      },
      400,
    );
  }

  logger.error("❌ Unhandled error", {
    errorCode: "INTERNAL_ERROR",
    message: err.message,
    stack: err.stack,
    traceId,
    userId,
    method: c.req.method,
    path: c.req.path,
  });

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        details: null,
      },
    },
    500,
  );
}
