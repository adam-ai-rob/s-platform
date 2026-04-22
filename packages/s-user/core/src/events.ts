import { z } from "zod";

export const UserProfilePayload = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .strict();
export type UserProfilePayload = z.infer<typeof UserProfilePayload>;

export const UserProfileDeletedPayload = z
  .object({
    userId: z.string(),
  })
  .strict();
export type UserProfileDeletedPayload = z.infer<typeof UserProfileDeletedPayload>;

export const userEventCatalog = {
  "user.profile.created": {
    schema: UserProfilePayload,
    summary: "A new user profile row was inserted (from user.registered).",
    example: {
      userId: "01HXYUSER000000000000000000",
      firstName: "",
      lastName: "",
    },
  },
  "user.profile.updated": {
    schema: UserProfilePayload,
    summary: "A user profile was updated (names or metadata).",
    example: {
      userId: "01HXYUSER000000000000000000",
      firstName: "Ada",
      lastName: "Lovelace",
    },
  },
  "user.profile.deleted": {
    schema: UserProfileDeletedPayload,
    summary:
      "A user profile row was removed (DDB REMOVE). Search indexes should drop the document.",
    example: {
      userId: "01HXYUSER000000000000000000",
    },
  },
} as const;
