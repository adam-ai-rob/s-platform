import { createApi, enableAip136Actions } from "@s/shared/http";
import { typesenseHealthProbe } from "@s/shared/search";
import admin from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

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
app.route("/user", userRoutes);
enableAip136Actions(app);

export default app;
