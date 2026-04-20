import { z } from "zod";

export const UserProfilePayload = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .strict();
export type UserProfilePayload = z.infer<typeof UserProfilePayload>;

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
} as const;
