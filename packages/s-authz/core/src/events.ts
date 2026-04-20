import { z } from "zod";

export const AuthzRolePayload = z
  .object({
    roleId: z.string(),
    name: z.string(),
  })
  .strict();
export type AuthzRolePayload = z.infer<typeof AuthzRolePayload>;

export const AuthzViewRebuiltPayload = z
  .object({
    userId: z.string(),
    permissionCount: z.number().int().nonnegative(),
  })
  .strict();
export type AuthzViewRebuiltPayload = z.infer<typeof AuthzViewRebuiltPayload>;

export const authzEventCatalog = {
  "authz.role.created": {
    schema: AuthzRolePayload,
    summary: "A role was created.",
    example: { roleId: "01HXYROLE000000000000000000", name: "editor" },
  },
  "authz.role.updated": {
    schema: AuthzRolePayload,
    summary: "A role was updated.",
    example: { roleId: "01HXYROLE000000000000000000", name: "editor" },
  },
  "authz.role.deleted": {
    schema: AuthzRolePayload,
    summary: "A role was deleted.",
    example: { roleId: "01HXYROLE000000000000000000", name: "editor" },
  },
  "authz.view.rebuilt": {
    schema: AuthzViewRebuiltPayload,
    summary: "A user's materialized permissions view was rebuilt.",
    example: {
      userId: "01HXYUSER000000000000000000",
      permissionCount: 3,
    },
  },
} as const;
