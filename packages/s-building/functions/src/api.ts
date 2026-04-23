import { createApi } from "@s/shared/http";
import { typesenseHealthProbe } from "@s/shared/search";
import admin from "./routes/admin.routes";
import type { AppEnv } from "./types";

/**
 * Rewrite `…/{resource}:{verb}` incoming URLs to `…/{resource}/_actions/{verb}`
 * before the Hono router sees them. Needed because Hono's three router
 * backends all treat `:` as a `:param` prefix and can't cleanly parse
 * Google AIP-136's `:verb` suffix. Routes are declared with the internal
 * `_actions/verb` path; the public URL stays `:verb` per
 * `docs/architecture/09-api-conventions.md`.
 *
 * `rewriteOpenApiActionPaths` below flips the `_actions/verb` paths back
 * to `:verb` in the emitted OpenAPI document so contract consumers see
 * the canonical shape.
 */
const ACTION_SUFFIX = /^(.*?)(\/[^/]+):([a-z][a-zA-Z0-9]*)$/;

function rewriteRequestPath(url: URL): URL | undefined {
  const m = url.pathname.match(ACTION_SUFFIX);
  if (!m) return undefined;
  const rewritten = new URL(url.toString());
  rewritten.pathname = `${m[1]}${m[2]}/_actions/${m[3]}`;
  return rewritten;
}

const app = createApi<AppEnv>({
  service: "s-building",
  title: "s-building — Building CRUD",
  description:
    "Building CRUD with scoped permissions + Typesense-backed admin/user lists. First resource-scoped module on the platform. Admin routes mount under /building/admin; consumer routes under /building/user.",
  version: "1.0.0",
  basePath: "/building",
  permissions: {
    building_superadmin: "Full access to every building, any status. Global, unscoped.",
    building_admin: "Full CRUD on buildings in the assignment's value scope.",
    building_manager: "Read + update on buildings in scope. Cannot archive, activate, or delete.",
    building_user: "Read active buildings in scope.",
  },
  events: {
    publishes: [
      "building.created",
      "building.updated",
      "building.activated",
      "building.archived",
      "building.deleted",
    ],
    subscribes: [],
  },
  topics: {
    "building-events": "Building lifecycle — created, updated, activated, archived, deleted",
  },
  probes: {
    typesense: typesenseHealthProbe,
  },
});

app.route("/admin", admin);

// User-audience routes land in #70. `createApi()` already provides
// /health, /info, /openapi.json, /docs so the module is deployable
// end-to-end with just the admin surface.

// Flip `/_actions/{verb}` → `:{verb}` in the emitted OpenAPI document so
// the contract matches the public URL convention. Consumers — including
// `scripts/build-contracts.ts` and `/openapi.json` at runtime — see the
// AIP-136 form.
const originalGetOpenAPIDocument = app.getOpenAPIDocument.bind(app);
app.getOpenAPIDocument = ((config: Parameters<typeof originalGetOpenAPIDocument>[0]) => {
  const doc = originalGetOpenAPIDocument(config) as { paths: Record<string, unknown> };
  if (doc.paths) {
    const remapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc.paths)) {
      remapped[key.replace(/\/_actions\/([a-z][a-zA-Z0-9]*)$/, ":$1")] = value;
    }
    doc.paths = remapped;
  }
  return doc;
}) as typeof app.getOpenAPIDocument;

// Route-time URL rewrite: accept the public `:verb` URL on the wire,
// forward to the `/_actions/verb` internal path for the router.
const originalFetch = app.fetch.bind(app);
const rewritingFetch: typeof app.fetch = (request, env, ctx) => {
  const url = new URL(request.url);
  const rewritten = rewriteRequestPath(url);
  if (!rewritten) return originalFetch(request, env, ctx);
  const newReq = new Request(rewritten.toString(), request);
  return originalFetch(newReq, env, ctx);
};
app.fetch = rewritingFetch;
// Hono's `app.request(path, init)` builds a Request internally and calls
// `app.fetch` — but in some versions it binds `fetch` at definition time
// and misses the override above. Also patch `request` directly so tests
// and any production caller on the Hono `.request` path go through the
// rewrite.
const originalRequest = app.request.bind(app);
const rewritingRequest: typeof app.request = (input, requestInit, env, ctx) => {
  if (typeof input === "string") {
    const url = new URL(input, "http://localhost");
    const rewritten = rewriteRequestPath(url);
    if (rewritten) {
      const outPath = `${rewritten.pathname}${rewritten.search}`;
      return originalRequest(outPath, requestInit, env, ctx);
    }
  }
  return originalRequest(input, requestInit, env, ctx);
};
app.request = rewritingRequest;

export default app;
