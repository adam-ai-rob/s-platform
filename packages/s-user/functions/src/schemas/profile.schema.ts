import { z } from "@hono/zod-openapi";
import { ListMetaSchema } from "@s/shared/types";

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

export const UserSearchHit = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
    highlights: z.record(z.unknown()).optional(),
  })
  .openapi("UserSearchHit");

export const UserSearchListResponse = z
  .object({
    data: z.array(UserSearchHit),
    meta: ListMetaSchema,
    metadata: z.object({ nextToken: z.string().optional() }).optional(),
  })
  .openapi("UserSearchListResponse");

export const LegacyUserSearchResponse = z
  .object({
    hits: z.array(UserSearchHit),
    data: z.array(UserSearchHit),
    meta: ListMetaSchema,
    metadata: z.object({ nextToken: z.string().optional() }).optional(),
    page: z.number().int(),
    per_page: z.number().int(),
    found: z.number().int(),
    out_of: z.number().int(),
    search_time_ms: z.number().int(),
    next_cursor: z.string().optional(),
  })
  .openapi("LegacyUserSearchResponse");

export const UserSearchQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  facet_by: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});
