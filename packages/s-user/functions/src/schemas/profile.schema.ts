import { z } from "@hono/zod-openapi";

const Int64 = z.number().int().openapi({ format: "int64" });

/**
 * Flat shape of a user document in Typesense — the admin list endpoint
 * returns this, NOT the full `ProfileSchema`. Consumers who need the
 * full row call `GET /user/admin/users/{id}` for any hit they care about.
 */
export const UserSearchHit = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    createdAtMs: Int64,
    updatedAtMs: Int64,
    highlights: z.record(z.unknown()).optional(),
  })
  .openapi("UserSearchHit");

const UserListMeta = z
  .object({
    page: z.number().int(),
    perPage: z.number().int(),
    found: z.number().int(),
    outOf: z.number().int(),
    searchTimeMs: z.number().int(),
    nextCursor: z.string().optional(),
  })
  .openapi("UserListMeta");

export const UserListResponse = z
  .object({
    data: z.array(UserSearchHit),
    meta: UserListMeta,
  })
  .openapi("UserListResponse");

export const UserListQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export const UserIdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" } }),
});

export const ProfileSchema = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    avatarUrl: z.string().optional(),
    preferences: z.record(z.unknown()),
    metadata: z.record(z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("UserProfile");

export const ProfileResponse = z
  .object({
    data: ProfileSchema,
  })
  .openapi("ProfileResponse");

/**
 * PATCH body. `null` / `""` / `[]` map to DynamoDB REMOVE via BaseRepository.patch,
 * so clients can drop a field without a separate endpoint.
 */
export const UpdateProfileBody = z
  .object({
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    avatarUrl: z.string().url().optional().nullable(),
    preferences: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .openapi("UpdateProfileBody");
