import { createApi } from "@s/shared/http";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const ACTION_SUFFIX = /^(.*?)(\/[^/]+):([a-z][a-zA-Z0-9]*)$/;
const INTERNAL_ACTION_SEGMENT = /\/_actions\//;

function rewriteRequestPath(url: URL): URL | undefined {
  const match = url.pathname.match(ACTION_SUFFIX);
  if (!match) return undefined;
  const rewritten = new URL(url.toString());
  rewritten.pathname = `${match[1]}${match[2]}/_actions/${match[3]}`;
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

app.route("/auth", authRoutes);
app.route("/user", userRoutes);

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

const originalRequest = app.request.bind(app);
const rewritingRequest: typeof app.request = (input, requestInit, env, ctx) => {
  if (typeof input === "string") {
    const url = new URL(input, "http://localhost");
    if (INTERNAL_ACTION_SEGMENT.test(url.pathname)) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    const rewritten = rewriteRequestPath(url);
    if (rewritten) {
      return originalRequest(`${rewritten.pathname}${rewritten.search}`, requestInit, env, ctx);
    }
  }
  return originalRequest(input, requestInit, env, ctx);
};
app.request = rewritingRequest;

export default app;
