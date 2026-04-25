import { createApi /* , enableAip136Actions */ } from "@s/shared/http";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "{module-name}",
  title: "{module-name} — TODO: one-line description",
  description: "TODO: bounded context description",
  version: "1.0.0",
  basePath: "/{module}",
  permissions: {
    "{module}_superadmin": "Full access to every resource in this module. Global, unscoped.",
    "{module}_admin": "Admin access to resources in the assignment's value scope.",
    // TODO: add "{module}_user" if the user audience needs a separate read scope.
  },
  events: {
    publishes: [
      // TODO: list events this module emits
      // "{module}.{entity}.created",
    ],
    subscribes: [
      // TODO: list events this module consumes
    ],
  },
  topics: {
    // TODO: logical groupings of events
    // "{module}-events": "Lifecycle events for this module's resources",
  },
});

app.route("/admin", adminRoutes);
app.route("/user", userRoutes);

// Uncomment when this module adopts Google AIP-136 custom actions such
// as POST /{module}/admin/resources/{id}:archive.
// enableAip136Actions(app);

export default app;
