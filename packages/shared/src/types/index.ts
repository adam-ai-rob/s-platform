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
 * List envelope v1 (camelCase fields).
 *
 * This is the canonical form for list responses. All list endpoints
 * should use this shape.
 */
export const ListResponseV1 = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    meta: z.object({
      page: z.number().int().positive(),
      perPage: z.number().int().positive(),
      found: z.number().int(),
      outOf: z.number().int(),
      searchTimeMs: z.number().int(),
      nextCursor: z.string().optional(),
      facets: z.array(z.unknown()).optional(),
    }),
  });

/**
 * List envelope v0 (snake_case fields, backward compatibility shim).
 *
 * For one release cycle during the v1 retrofit, both envelopes are
 * supported. Code should migrate to v1 as soon as possible. In the
 * next release, this shim should be removed along with the legacy
 * endpoints.
 */
export const ListResponseV0 = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    metadata: z
      .object({
        nextToken: z.string().optional(),
      })
      .optional(),
  });

/**
 * Response envelope factory — deprecated, use ListResponseV1.
 *
 * This is a migration shim that returns v0 format for backward
 * compatibility during the v1 retrofit period. New code MUST use
 * ListResponseV1.
 *
 * DEPRECATED: Use ListResponseV1<T> instead. Will be removed in the
 * next release after v1 retrofit is complete.
 */
export const ListResponse = ListResponseV0;

/**
 * Single resource response envelope.
 */
export const SingleResponse = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
