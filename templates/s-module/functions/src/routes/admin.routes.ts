import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware } from "@s/shared/auth";
import { ForbiddenError } from "@s/shared/errors";
import { CreateResourceBody, ResourceResponse } from "../schemas/{module}.schema";
import type { AppEnv } from "../types";
import { hasSuperadmin } from "./_access";

const admin = new OpenAPIHono<AppEnv>();

admin.use("*", authMiddleware());

admin.openapi(
  createRoute({
    method: "post",
    path: "/resources",
    tags: ["{Module} Admin"],
    security: [{ Bearer: [] }],
    summary: "Create a resource",
    description:
      "Scaffold create route. Replace the placeholder body with one service call. Requires `{module}_superadmin` by default.",
    request: {
      body: { content: { "application/json": { schema: CreateResourceBody } }, required: true },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ResourceResponse } },
        description: "Created",
        headers: {
          Location: {
            schema: { type: "string" },
            description: "Canonical URL of the new resource",
          },
        },
      },
      400: { description: "Validation error" },
      403: { description: "Missing permission" },
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!hasSuperadmin(user) && user.system !== true) {
      throw new ForbiddenError("{module}_superadmin required to create resources");
    }

    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const resource = {
      id: "replace-with-created-id",
      name: body.name,
      createdAt: now,
      updatedAt: now,
      createdAtMs: Date.parse(now),
      updatedAtMs: Date.parse(now),
    };

    // For scoped modules, replace the global-only gate above with a
    // route-layer check against the target id:
    // if (!resourceAccess(user, resource.id, ["{module}_admin"])) {
    //   throw new ForbiddenError(`No admin access to resource ${resource.id}`);
    // }
    //
    // Keep this in the route layer. Services stay permission-agnostic.

    c.header("Location", `/{module}/admin/resources/${resource.id}`);
    return c.json({ data: resource }, 201);
  },
);

export default admin;
