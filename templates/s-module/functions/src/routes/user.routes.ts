import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware } from "@s/shared/auth";
import { ResourceIdParam, ResourceResponse } from "../schemas/{module}.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

user.use("*", authMiddleware());

// Keep both audience routers present in every module. Admin routes use
// 403 for permission gaps; user routes collapse hidden resources to 404.

user.openapi(
  createRoute({
    method: "get",
    path: "/resources/{id}",
    tags: ["{Module} User"],
    security: [{ Bearer: [] }],
    summary: "Get a visible resource",
    description:
      "Scaffold user-audience read route. User routes should return 404, not 403, when a resource is hidden from the caller.",
    request: { params: ResourceIdParam },
    responses: {
      200: { content: { "application/json": { schema: ResourceResponse } }, description: "Ok" },
      404: { description: "Not found, or not visible to the caller" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const now = new Date().toISOString();

    // Implementation hint for real resources:
    //   1. Check caller scope in this route.
    //   2. Throw NotFoundError on a scope miss to hide existence.
    //   3. Load the resource through one service method.
    //   4. Throw NotFoundError if missing or not user-visible.
    //
    // Example:
    // import { NotFoundError } from "@s/shared/errors";
    // if (!resourceAccess(c.get("user"), id, ["{module}_user"])) {
    //   throw new NotFoundError(`Resource ${id} not found`);
    // }

    return c.json(
      {
        data: {
          id,
          name: "TODO resource",
          createdAt: now,
          updatedAt: now,
          createdAtMs: Date.parse(now),
          updatedAtMs: Date.parse(now),
        },
      },
      200,
    );
  },
);

export default user;
