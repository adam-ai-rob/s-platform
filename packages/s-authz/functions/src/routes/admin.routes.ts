import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createRole, deleteRole, getRole } from "@s-authz/core/roles/roles.service";
import {
  assignRoleToUser,
  unassignRoleFromUser,
} from "@s-authz/core/user-roles/user-roles.service";
import { authMiddleware, requirePermission } from "@s/shared/auth";
import { AssignRoleBody, CreateRoleBody, RoleResponse } from "../schemas/authz.schema";
import type { AppEnv } from "../types";

const admin = new OpenAPIHono<AppEnv>();

// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", authMiddleware() as any);
// biome-ignore lint/suspicious/noExplicitAny: generic middleware adapter
admin.use("*", requirePermission("authz_admin") as any);

// POST /admin/roles
admin.openapi(
  createRoute({
    method: "post",
    path: "/roles",
    tags: ["Authz Admin"],
    security: [{ Bearer: [] }],
    summary: "Create a role",
    request: {
      body: { content: { "application/json": { schema: CreateRoleBody } }, required: true },
    },
    responses: {
      201: { content: { "application/json": { schema: RoleResponse } }, description: "Created" },
      409: { description: "Role name already exists" },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const role = await createRole(body);
    return c.json({ data: role }, 201);
  },
);

// GET /admin/roles/{id}
admin.openapi(
  createRoute({
    method: "get",
    path: "/roles/{id}",
    tags: ["Authz Admin"],
    security: [{ Bearer: [] }],
    summary: "Get a role",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { content: { "application/json": { schema: RoleResponse } }, description: "Role" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const role = await getRole(id);
    return c.json({ data: role }, 200);
  },
);

// DELETE /admin/roles/{id}
admin.openapi(
  createRoute({
    method: "delete",
    path: "/roles/{id}",
    tags: ["Authz Admin"],
    security: [{ Bearer: [] }],
    summary: "Delete a role",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      204: { description: "Deleted" },
      404: { description: "Not found" },
      409: { description: "System roles cannot be deleted" },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    await deleteRole(id);
    return c.body(null, 204);
  },
);

// POST /admin/users/{userId}/roles/{roleId}
admin.openapi(
  createRoute({
    method: "post",
    path: "/users/{userId}/roles/{roleId}",
    tags: ["Authz Admin"],
    security: [{ Bearer: [] }],
    summary: "Assign a role to a user (optionally with a scope value)",
    description:
      "Assigns `roleId` to `userId`. The optional `value` array is the per-assignment scope for scope-requiring permissions (e.g. building UUIDs for the `building-admin` role). Idempotent: re-assigning the same role unions the incoming `value` with any existing scope on the row — no 409.",
    request: {
      params: z.object({ userId: z.string(), roleId: z.string() }),
      body: {
        content: { "application/json": { schema: AssignRoleBody } },
        required: false,
      },
    },
    responses: {
      204: { description: "Assigned (or scope extended)" },
      404: { description: "Role not found" },
    },
  }),
  async (c) => {
    const { userId, roleId } = c.req.valid("param");
    // Body is optional (request.body.required = false). Parse defensively:
    // an absent or empty body is treated as "no scope value".
    const parsed = (await c.req.json().catch(() => ({}))) as { value?: unknown[] };
    const value = Array.isArray(parsed.value) ? parsed.value : undefined;
    const caller = c.get("user");
    await assignRoleToUser({
      userId,
      roleId,
      ...(value ? { value } : {}),
      createdBy: caller.userId,
    });
    return c.body(null, 204);
  },
);

// DELETE /admin/users/{userId}/roles/{roleId}
admin.openapi(
  createRoute({
    method: "delete",
    path: "/users/{userId}/roles/{roleId}",
    tags: ["Authz Admin"],
    security: [{ Bearer: [] }],
    summary: "Unassign a role from a user",
    request: {
      params: z.object({ userId: z.string(), roleId: z.string() }),
    },
    responses: {
      204: { description: "Unassigned" },
      404: { description: "Assignment not found" },
    },
  }),
  async (c) => {
    const { userId, roleId } = c.req.valid("param");
    await unassignRoleFromUser({ userId, roleId });
    return c.body(null, 204);
  },
);

export default admin;
