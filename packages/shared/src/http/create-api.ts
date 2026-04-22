import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { authMiddleware } from "../auth/middleware";
import { globalErrorHandler } from "../errors/handler";
import { traceMiddleware } from "../trace/middleware";

export interface ApiProbeResult {
  status: "up" | "down";
  detail?: string;
}

/**
 * Optional liveness probes surfaced through `/info`.
 *
 * Modules register probes for external dependencies that belong in the
 * platform contract (search cluster, cache, third-party APIs) so the
 * /info endpoint can report their health without every module
 * hand-rolling its own health route.
 *
 * Probes run in parallel on every /info call, must not throw, and
 * should return within a second or two. Timeouts are the caller's
 * responsibility — this wrapper will swallow errors and downgrade to
 * `{ status: "down", detail }` rather than bringing /info down.
 */
export type ApiProbe = () => Promise<ApiProbeResult>;

/**
 * Metadata declared by each module's /info endpoint.
 *
 * - `permissions`: catalog of permission IDs this module consumes
 * - `events.publishes`: event names this module emits
 * - `events.subscribes`: event names this module listens for
 * - `topics`: logical groupings of events (human-readable)
 * - `errorCodes`: map of error codes → human-readable meaning
 * - `probes`: optional liveness probes for external dependencies
 */
export interface ApiMetadata {
  service: string;
  title: string;
  description: string;
  version: string;
  /**
   * Mount path under the shared API Gateway. Every module Lambda is
   * reached via a path-prefix rule (`ANY /{module}/{proxy+}`), and the
   * Lambda sees that full prefix. Supply it here so /health, /info,
   * /openapi.json, /docs and all mounted routes resolve correctly.
   *
   * Example: `basePath: "/authn"` → `/authn/health`, `/authn/info`,
   * `/authn/openapi.json`, `/authn/auth/login`, etc.
   *
   * Leave `undefined` only for single-module deployments where the
   * Lambda serves the gateway root.
   */
  basePath?: string;
  permissions: Record<string, string>;
  events: { publishes: string[]; subscribes: string[] };
  topics: Record<string, string>;
  errorCodes?: Record<string, string>;
  probes?: Record<string, ApiProbe>;
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
  const root = new OpenAPIHono<TEnv>();
  // Apply basePath so every subsequently-registered route is prefixed
  // (including /health, /info, /openapi.json, /docs AND whatever the
  // caller later mounts via `app.route(...)`).
  const app = metadata.basePath ? root.basePath(metadata.basePath) : root;

  app.use("*", traceMiddleware());

  app.get("/health", (c) => c.json({ status: "ok" }));

  // /info requires authentication so only platform users can introspect
  // biome-ignore lint/suspicious/noExplicitAny: generic Hono middleware adapter
  app.get("/info", authMiddleware() as any, async (c) => {
    const probes = await runProbes(metadata.probes);
    return c.json({
      data: {
        service: metadata.service,
        stage: process.env.STAGE ?? "dev",
        version: process.env.VERSION ?? metadata.version,
        permissions: metadata.permissions,
        events: metadata.events,
        topics: metadata.topics,
        errorCodes: metadata.errorCodes ?? {},
        ...(probes ? { probes } : {}),
      },
    });
  });

  // app.doc registers at the current basePath — e.g. /authn/openapi.json
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

  // Swagger UI points at the openapi.json sibling — prefix-aware.
  app.get("/docs", swaggerUI({ url: `${metadata.basePath ?? ""}/openapi.json` }));

  // biome-ignore lint/suspicious/noExplicitAny: generic Hono context
  app.onError(globalErrorHandler as any);

  return app;
}

async function runProbes(
  probes: Record<string, ApiProbe> | undefined,
): Promise<Record<string, ApiProbeResult> | undefined> {
  if (!probes) return undefined;
  const entries = Object.entries(probes);
  if (entries.length === 0) return undefined;

  const results = await Promise.all(
    entries.map(async ([name, probe]): Promise<[string, ApiProbeResult]> => {
      try {
        return [name, await probe()];
      } catch (err) {
        return [name, { status: "down", detail: (err as Error).message }];
      }
    }),
  );
  return Object.fromEntries(results);
}
