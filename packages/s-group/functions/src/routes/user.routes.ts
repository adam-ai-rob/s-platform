import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { listGroupsForUser } from "@s-group/core/memberships/memberships.service";
import { authMiddleware } from "@s/shared/auth";
import { MembershipListResponse } from "../schemas/group.schema";
import type { AppEnv } from "../types";

const user = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
user.use("*", authMiddleware() as any);

user.openapi(
  createRoute({
    method: "get",
    path: "/me/groups",
    tags: ["Group"],
    security: [{ Bearer: [] }],
    summary: "List caller's group memberships",
    responses: {
      200: {
        content: { "application/json": { schema: MembershipListResponse } },
        description: "Memberships",
      },
    },
  }),
  async (c) => {
    const caller = c.get("user");
    const memberships = await listGroupsForUser(caller.userId);
    return c.json(
      {
        data: memberships,
        meta: {
          page: 1,
          perPage: memberships.length,
          found: memberships.length,
          outOf: memberships.length,
          searchTimeMs: 0,
        },
        metadata: {},
      },
      200,
    );
  },
);

export default user;
