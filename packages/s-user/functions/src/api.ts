import { createApi } from "@s/shared/http";
import { typesenseHealthProbe } from "@s/shared/search";
import admin from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
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

app.route("/admin", admin);
app.route("/user", userRoutes);

export default app;
