import { createApi } from "@s/shared/http";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-authz",
  title: "s-authz — Authorization Service",
  description:
    "Roles, permissions, and the materialized AuthzView used by every other module's auth middleware.",
  version: "1.0.0",
  basePath: "/authz",
  permissions: {
    authz_admin: "Manage roles and role assignments",
    user_superadmin: "Full access to every user profile (s-user admin). Global, unscoped.",
  },
  events: {
    publishes: [
      "authz.role.created",
      "authz.role.updated",
      "authz.role.deleted",
      "authz.view.rebuilt",
    ],
    subscribes: [
      "user.registered",
      "user.enabled",
      "user.disabled",
      "group.user.activated",
      "group.user.deactivated",
    ],
  },
  topics: {
    "authz-events": "Role lifecycle and authz-view rebuild events",
  },
});

app.route("/user", userRoutes);
app.route("/admin", adminRoutes);

export default app;
