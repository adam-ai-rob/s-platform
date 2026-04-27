import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { getPermissionsForUser } from "@s-authz/core/view/view.service";
import { authMiddleware } from "@s/shared/auth";
import { PermissionsResponse } from "../schemas/authz.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

user.openapi(
  createRoute({
    method: "get",
    path: "/me/permissions",
    tags: ["Authz"],
    security: [{ Bearer: [] }],
    summary: "Get the caller's effective permissions",
    description:
      "Returns the authenticated caller's materialized permission view. Permissions may include scoped `value` arrays for resource-scoped roles.",
    responses: {
      200: {
        content: { "application/json": { schema: PermissionsResponse } },
        description: "Permissions",
      },
      401: { description: "Missing or invalid bearer token" },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const permissions = await getPermissionsForUser(caller.userId);
    return c.json({ data: { userId: caller.userId, permissions } }, 200);
  },
);

export default user;
