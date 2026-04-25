import { createApi, enableAip136Actions } from "@s/shared/http";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-authn",
  title: "s-authn — Authentication Service",
  description: "Platform identity, credentials, JWT issuance, JWKS, and refresh-token management.",
  version: "1.0.0",
  basePath: "/authn",
  // Phase 2 permissions (audit log, admin user CRUD) will be added here when the endpoints land.
  permissions: {},
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
enableAip136Actions(app);

export default app;
