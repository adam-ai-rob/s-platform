import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { authMiddleware } from "../auth/middleware";
import { globalErrorHandler } from "../errors/handler";
import { traceMiddleware } from "../trace/middleware";

/**
 * Metadata declared by each module's /info endpoint.
 *
 * - `permissions`: catalog of permission IDs this module consumes
 * - `events.publishes`: event names this module emits
 * - `events.subscribes`: event names this module listens for
 * - `topics`: logical groupings of events (human-readable)
 * - `errorCodes`: map of error codes → human-readable meaning
 */
export interface ApiMetadata {
  service: string;
  title: string;
  description: string;
  version: string;
  permissions: Record<string, string>;
  events: { publishes: string[]; subscribes: string[] };
  topics: Record<string, string>;
  errorCodes?: Record<string, string>;
}

/**
 * Factory that creates an OpenAPIHono app with the four mandatory
 * endpoints pre-wired:
 *
 *   GET /health        — public, { status: "ok" }
 *   GET /info          — authenticated, returns ApiMetadata
 *   GET /openapi.json  — public, auto-generated OpenAPI 3.1 spec
 *   GET /docs          — public, Swagger UI
 *
 * Trace middleware runs on all routes. Global error handler is
 * registered. Modules add their own routes via `app.route(...)` or
 * `app.openapi(...)`.
 *
 * Usage:
 *   const app = createApi<AppEnv>({
 *     service: "s-authn",
 *     title: "s-authn — Authentication Service",
 *     ...
 *   });
 *   app.route("/auth", authRoutes);
 *   export default app;
 */
export function createApi<TEnv extends { Variables: Record<string, unknown> }>(
  metadata: ApiMetadata,
) {
  const app = new OpenAPIHono<TEnv>();

  app.use("*", traceMiddleware());

  app.get("/health", (c) => c.json({ status: "ok" }));

  // /info requires authentication so only platform users can introspect
  // biome-ignore lint/suspicious/noExplicitAny: generic Hono middleware adapter
  app.get("/info", authMiddleware() as any, (c) =>
    c.json({
      data: {
        service: metadata.service,
        stage: process.env["STAGE"] ?? "dev",
        version: process.env["VERSION"] ?? metadata.version,
        permissions: metadata.permissions,
        events: metadata.events,
        topics: metadata.topics,
        errorCodes: metadata.errorCodes ?? {},
      },
    }),
  );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: metadata.title,
      version: metadata.version,
      description: metadata.description,
    },
    servers: [
      { url: "https://s-api.smartiqi.com", description: "Prod" },
      { url: "https://test.s-api.smartiqi.com", description: "Test" },
      { url: "https://dev.s-api.smartiqi.com", description: "Dev" },
    ],
    security: [{ Bearer: [] }],
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  // biome-ignore lint/suspicious/noExplicitAny: generic Hono context
  app.onError(globalErrorHandler as any);

  return app;
}
