import { createApi } from "@s/shared/http";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-user",
  title: "s-user — User Profile Service",
  description:
    "User profile data (names, avatar, preferences, metadata). Profiles are created automatically from s-authn's user.registered event.",
  version: "1.0.0",
  permissions: {
    user_admin: "Read/update any user's profile (Phase 2)",
  },
  events: {
    publishes: ["user.profile.created", "user.profile.updated"],
    subscribes: ["user.registered"],
  },
  topics: {
    "user-profile-events": "Profile lifecycle — created, updated",
  },
});

app.route("/user", userRoutes);

export default app;
