import { createApi } from "@s/shared/http";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-group",
  title: "s-group — Groups and Memberships",
  description: "Groups, memberships, and domain-based auto-assignment on user.registered.",
  version: "1.0.0",
  basePath: "/group",
  permissions: {
    group_admin: "Create/update/delete groups and manage memberships",
  },
  events: {
    publishes: [
      "group.created",
      "group.updated",
      "group.deleted",
      "group.user.activated",
      "group.user.deactivated",
    ],
    subscribes: ["user.registered"],
  },
  topics: {
    "group-events": "Group + membership lifecycle",
  },
});

app.route("/user", userRoutes);
app.route("/admin", adminRoutes);

export default app;
