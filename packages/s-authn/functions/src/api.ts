import { createApi } from "@s/shared/http";
import authRoutes, { deprecatedAuth } from "./routes/auth.routes";
import userRoutes, { deprecatedUser } from "./routes/user.routes";
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
  service: "s-authn",
  title: "s-authn — Authentication Service",
  description: "Platform identity, credentials, JWT issuance, JWKS, and refresh-token management.",
  version: "1.0.0",
  basePath: "/authn",
  permissions: {
    authn_admin: "Full CRUD on AuthnUsers, view audit logs (Phase 2)",
    authn_read: "Read-only access to AuthnUser records (Phase 2)",
    user_superadmin:
      "Full access to modify any user's password (s-user password admin). Global, unscoped.",
  },
  events: {
    publishes: ["user.registered", "user.enabled", "user.disabled", "user.password.changed"],
    subscribes: [],
  },
  topics: {
    "user-events": "Lifecycle events for AuthnUser (registration, enable/disable, password change)",
  },
  errorCodes: {
    INVALID_CREDENTIALS: "Email or password incorrect",
    USER_DISABLED: "Account disabled by admin",
    PASSWORD_EXPIRED: "Password requires reset",
    EMAIL_ALREADY_EXISTS: "Registration with duplicate email",
    REFRESH_TOKEN_INVALID: "Refresh token not found or already revoked",
    REFRESH_TOKEN_EXPIRED: "Refresh token past its expiration",
    USER_NOT_FOUND: "No user exists with the given identifier",
  },
});

// Mount new v1 routes
app.route("/auth", authRoutes);
app.route("/user", userRoutes);

// AIP-136 workaround: rewrite public `:verb` URLs to internal `/_actions/verb`
// This must be done after routes are mounted
const INTERNAL_ACTION_SEGMENT = /\/_actions\//;
const originalFetch = app.fetch.bind(app);
const rewritingFetch: typeof app.fetch = (request, env, ctx) => {
  const url = new URL(request.url);
  if (INTERNAL_ACTION_SEGMENT.test(url.pathname)) {
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  const rewritten = rewriteRequestPath(url);
  if (!rewritten) return originalFetch(request, env, ctx);
  const newReq = new Request(rewritten.toString(), request);
  return originalFetch(newReq, env, ctx);
};
app.fetch = rewritingFetch;

// Flip `/_actions/{verb}` → `:{verb}` in the emitted OpenAPI document
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

// Mount legacy routes at the root (with deprecation)
// Legacy paths: /user/me/logout, /user/me/password
app.route("/auth", deprecatedAuth);
app.route("/user", deprecatedUser);

export default app;
