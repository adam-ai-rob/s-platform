import { createApi } from "@s/shared/http";
import { typesenseHealthProbe } from "@s/shared/search";
import userSearchRoutes from "./routes/user-search.routes";
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

// basePath already provides /user; mount user routes at the base.
// Order matters: the user-search routes MUST be mounted before the
// parameterised `GET /user/{id}` route, otherwise `/user/search` is
// captured as an {id} lookup and 404s.
app.route("/", userSearchRoutes);
app.route("/", userRoutes);

export default app;
