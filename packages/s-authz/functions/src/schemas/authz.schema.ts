import { z } from "@hono/zod-openapi";
import {
  MAX_ASSIGNMENT_VALUE_COUNT,
  MAX_ASSIGNMENT_VALUE_JSON_BYTES,
  MAX_USER_ROLE_ASSIGNMENTS,
  normalizeAssignmentValue,
} from "@s-authz/core/user-roles/user-roles.entity";
import { DomainError } from "@s/shared/errors";

export const PermissionSchema = z
  .object({
    id: z.string(),
    value: z.array(z.unknown()).optional(),
  })
  .openapi("Permission");

export const RoleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    permissions: z.array(PermissionSchema),
    childRoleIds: z.array(z.string()),
    system: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AuthzRole");

export const RoleResponse = z.object({ data: RoleSchema }).openapi("RoleResponse");

export const CreateRoleBody = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissions: z.array(PermissionSchema).default([]),
    childRoleIds: z.array(z.string()).default([]),
  })
  .openapi("CreateRoleBody");

export const PermissionsResponse = z
  .object({
    data: z.object({
      userId: z.string(),
      permissions: z.array(PermissionSchema),
    }),
  })
  .openapi("PermissionsResponse");

/**
 * Body for `POST /admin/users/{userId}/roles/{roleId}`.
 *
 * `value` is the per-assignment scope (e.g. building UUIDs for the
 * `building-admin` role). Optional — omitting it preserves legacy
 * behaviour. Re-assigning the same role unions incoming `value` with
 * any existing scope on the row. Each user can have at most
 * MAX_USER_ROLE_ASSIGNMENTS role assignments. The persisted unique scope
 * is capped at MAX_ASSIGNMENT_VALUE_COUNT entries and
 * MAX_ASSIGNMENT_VALUE_JSON_BYTES serialized bytes.
 */
export const AssignRoleBody = z
  .object({
    value: z
      .array(z.unknown())
      .superRefine((value, ctx) => {
        try {
          normalizeAssignmentValue(value);
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err instanceof DomainError ? err.message : "Invalid assignment value",
          });
        }
      })
      .optional(),
  })
  .openapi({
    description: `Optional per-assignment scope. Each user can have at most ${MAX_USER_ROLE_ASSIGNMENTS} role assignments. The stored unique scope is capped at ${MAX_ASSIGNMENT_VALUE_COUNT} entries and ${MAX_ASSIGNMENT_VALUE_JSON_BYTES} serialized bytes.`,
  })
  .openapi("AssignRoleBody");
