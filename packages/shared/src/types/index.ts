import { z } from "zod";

/**
 * Permission — flat representation of an authorization claim.
 *
 * Simple permission:       { id: "user_admin" }
 * Value-scoped permission: { id: "manage_locations", value: ["nyc", "sf"] }
 */
export const PermissionSchema = z.object({
  id: z.string(),
  value: z.array(z.unknown()).optional(),
});
export type Permission = z.infer<typeof PermissionSchema>;

/**
 * UserContext — set by the auth middleware, available on the Hono context.
 *
 * `system: true` indicates an internal service-to-service call, not a user request.
 */
export const UserContextSchema = z.object({
  userId: z.string(),
  permissions: z.array(PermissionSchema),
  system: z.boolean().optional(),
});
export type UserContext = z.infer<typeof UserContextSchema>;

/**
 * Standard response envelopes.
 */
export const SingleResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data });

export const ListResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    metadata: z
      .object({
        nextToken: z.string().optional(),
      })
      .optional(),
  });

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
