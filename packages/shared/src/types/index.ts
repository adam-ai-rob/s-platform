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
export const SingleResponse = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

/**
 * List response envelope — v1 REST conventions (`docs/architecture/09-api-conventions.md`).
 * Typesense-backed list endpoints return `{ data, meta }` with page/cursor state
 * camelCased on the wire.
 */
export const ListMeta = z.object({
  page: z.number().int(),
  perPage: z.number().int(),
  found: z.number().int(),
  outOf: z.number().int(),
  searchTimeMs: z.number().int(),
  nextCursor: z.string().optional(),
  facets: z
    .array(
      z.object({
        field: z.string(),
        counts: z.array(z.object({ value: z.string(), count: z.number().int() })),
      }),
    )
    .optional(),
});

export const ListResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    meta: ListMeta,
  });

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
