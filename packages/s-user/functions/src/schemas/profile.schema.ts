import { z } from "@hono/zod-openapi";

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
