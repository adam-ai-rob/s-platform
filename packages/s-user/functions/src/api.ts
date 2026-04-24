import { createApi } from "@s/shared/http";
import { typesenseHealthProbe } from "@s/shared/search";
import adminRoutes from "./routes/admin.routes";
import userSearchRoutes from "./routes/user-search.routes";
import userRoutes, { deprecatedUser } from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-user",
  title: "s-user — User Profile Service",
  description:
    "User profile data (names, avatar, preferences, metadata). Profiles are created automatically from s-authn's user.registered event. Search is backed by Typesense.",
  version: "1.0.0",
  basePath: "/user",
  permissions: {
    user_superadmin: "Full access to every user profile. Global, unscoped.",
    user_admin: "Read/update any user's profile (Phase 2)",
  },
  events: {
    publishes: ["user.profile.created", "user.profile.updated", "user.profile.deleted"],
    subscribes: ["user.registered"],
  },
  topics: {
    "user-profile-events": "Profile lifecycle — created, updated, deleted",
  },
  probes: {
    typesense: typesenseHealthProbe,
  },
});

// Mount new v1 routes first
app.route("/admin", adminRoutes);
app.route("/user", userRoutes);

// Mount legacy routes at the root (with deprecation)
// Legacy paths: /me, /{id}, /search
// Order matters: newer routes must come before legacy fallbacks
app.route("/", userSearchRoutes);
app.route("/", deprecatedUser);

export default app;
