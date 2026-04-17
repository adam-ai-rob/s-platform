import { createApi } from "@s/shared/http";
import type { AppEnv } from "./types";

const app = createApi<AppEnv>({
  service: "s-{module-name}",
  title: "s-{module-name} — TODO: one-line description",
  description: "TODO: bounded context description",
  version: "1.0.0",
  permissions: {
    // TODO: list permissions this module checks
    // "{module}_admin": "Full admin access to this module's resources",
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

// TODO: mount routes
// import { routes } from "./routes/index";
// app.route("/{module}", routes);

export default app;
