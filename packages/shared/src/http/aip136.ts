import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Env, Schema } from "hono";

const ACTION_SUFFIX = /^(.*?)(\/[^/]+):([a-z][a-zA-Z0-9]*)$/;
const INTERNAL_ACTION_SEGMENT = /\/_actions\//;

function rewriteRequestPath(url: URL): URL | undefined {
  const match = url.pathname.match(ACTION_SUFFIX);
  if (!match) return undefined;
  const rewritten = new URL(url.toString());
  rewritten.pathname = `${match[1]}${match[2]}/_actions/${match[3]}`;
  return rewritten;
}

/**
 * Enable Google AIP-136 `:verb` public URLs for Hono/OpenAPIHono apps.
 *
 * Modules still register custom-action routes on internal
 * `/.../_actions/{verb}` paths. This wrapper rewrites public
 * `/.../{resource}:verb` requests before routing, blocks direct ingress
 * to `/_actions/`, and emits the public `:verb` form in OpenAPI.
 */
export function enableAip136Actions<E extends Env, S extends Schema, BasePath extends string>(
  app: OpenAPIHono<E, S, BasePath>,
): void {
  const originalGetOpenAPIDocument = app.getOpenAPIDocument.bind(app);
  app.getOpenAPIDocument = (config) => {
    const doc = originalGetOpenAPIDocument(config);
    if (doc.paths) {
      const remapped: typeof doc.paths = {};
      for (const [key, value] of Object.entries(doc.paths)) {
        remapped[key.replace(/\/_actions\/([a-z][a-zA-Z0-9]*)$/, ":$1")] = value;
      }
      doc.paths = remapped;
    }
    return doc;
  };

  const originalFetch = app.fetch.bind(app);
  app.fetch = (request, env, ctx) => {
    const url = new URL(request.url);
    if (INTERNAL_ACTION_SEGMENT.test(url.pathname)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const rewritten = rewriteRequestPath(url);
    if (!rewritten) return originalFetch(request, env, ctx);
    const newReq = new Request(rewritten.toString(), request);
    return originalFetch(newReq, env, ctx);
  };

  const originalRequest = app.request.bind(app);
  app.request = (input, requestInit, env, ctx) => {
    if (typeof input === "string") {
      const url = new URL(input, "http://localhost");
      if (INTERNAL_ACTION_SEGMENT.test(url.pathname)) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const rewritten = rewriteRequestPath(url);
      if (rewritten) {
        return originalFetch(new Request(rewritten.toString(), requestInit), env, ctx);
      }
    }
    return originalRequest(input, requestInit, env, ctx);
  };
}
