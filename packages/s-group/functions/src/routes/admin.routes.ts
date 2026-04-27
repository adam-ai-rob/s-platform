import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createNewGroup, deleteGroup, getGroup } from "@s-group/core/groups/groups.service";
import { addUserToGroup, removeUserFromGroup } from "@s-group/core/memberships/memberships.service";
import { authMiddleware, requirePermission } from "@s/shared/auth";
import { CreateGroupBody, GroupResponse } from "../schemas/group.schema";
import type { AppEnv } from "../types";

const admin = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", authMiddleware() as any);
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", requirePermission("group_admin") as any);

admin.openapi(
  createRoute({
    method: "post",
    path: "/groups",
    tags: ["Group Admin"],
    security: [{ Bearer: [] }],
    summary: "Create a group",
    description:
      "Creates a group with a unique name and optional domain-matching configuration. Requires a bearer token with `group_admin`.",
    request: {
      body: { content: { "application/json": { schema: CreateGroupBody } }, required: true },
    },
    responses: {
      201: { content: { "application/json": { schema: GroupResponse } }, description: "Created" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing group_admin permission" },
      409: { description: "Name exists" },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const group = await createNewGroup(body);
    return c.json({ data: group }, 201);
  },
);

admin.openapi(
  createRoute({
    method: "get",
    path: "/groups/{id}",
    tags: ["Group Admin"],
    security: [{ Bearer: [] }],
    summary: "Get a group",
    description: "Returns one group by id. Requires a bearer token with `group_admin`.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: GroupResponse } }, description: "Group" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing group_admin permission" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const g = await getGroup(id);
    return c.json({ data: g }, 200);
  },
);

admin.openapi(
  createRoute({
    method: "delete",
    path: "/groups/{id}",
    tags: ["Group Admin"],
    security: [{ Bearer: [] }],
    summary: "Delete a group",
    description:
      "Deletes a group by id. Requires a bearer token with `group_admin`; returns 404 when the group does not exist.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      204: { description: "Deleted" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing group_admin permission" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    await deleteGroup(id);
    return c.body(null, 204);
  },
);

admin.openapi(
  createRoute({
    method: "post",
    path: "/groups/{id}/users/{userId}",
    tags: ["Group Admin"],
    security: [{ Bearer: [] }],
    summary: "Add a user to a group (rel: manual)",
    description:
      "Creates a manual membership between the group and user. Requires `group_admin`; returns 409 if the manual membership already exists.",
    request: {
      params: z.object({ id: z.string(), userId: z.string() }),
    },
    responses: {
      204: { description: "Added" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing group_admin permission" },
      404: { description: "Group not found" },
      409: { description: "Already a member" },
    },
  }),
  async (c) => {
    const { id, userId } = c.req.valid("param");
    const caller = c.get("user");
    await addUserToGroup({ groupId: id, userId, addedBy: caller.userId });
    return c.body(null, 204);
  },
);

admin.openapi(
  createRoute({
    method: "delete",
    path: "/groups/{id}/users/{userId}",
    tags: ["Group Admin"],
    security: [{ Bearer: [] }],
    summary: "Remove a user from a group (rel: manual)",
    description:
      "Removes an existing manual membership between the group and user. Requires `group_admin`; returns 404 when the membership does not exist.",
    request: {
      params: z.object({ id: z.string(), userId: z.string() }),
    },
    responses: {
      204: { description: "Removed" },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Missing group_admin permission" },
      404: { description: "Membership not found" },
    },
  }),
  async (c) => {
    const { id, userId } = c.req.valid("param");
    await removeUserFromGroup({ groupId: id, userId });
    return c.body(null, 204);
  },
);

export default admin;
