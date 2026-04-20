import { z } from "zod";

export const GroupPayload = z
  .object({
    groupId: z.string(),
    name: z.string(),
  })
  .strict();
export type GroupPayload = z.infer<typeof GroupPayload>;

export const GroupMembershipPayload = z
  .object({
    userId: z.string(),
    groupId: z.string(),
    rel: z.enum(["owner", "manual", "domain", "group"]),
  })
  .strict();
export type GroupMembershipPayload = z.infer<typeof GroupMembershipPayload>;

export const groupEventCatalog = {
  "group.created": {
    schema: GroupPayload,
    summary: "A group was created.",
    example: { groupId: "01HXYGROUP00000000000000000", name: "platform-team" },
  },
  "group.updated": {
    schema: GroupPayload,
    summary: "A group was updated.",
    example: { groupId: "01HXYGROUP00000000000000000", name: "platform-team" },
  },
  "group.deleted": {
    schema: GroupPayload,
    summary: "A group was deleted.",
    example: { groupId: "01HXYGROUP00000000000000000", name: "platform-team" },
  },
  "group.user.activated": {
    schema: GroupMembershipPayload,
    summary: "A user became an active member of a group.",
    example: {
      userId: "01HXYUSER000000000000000000",
      groupId: "01HXYGROUP00000000000000000",
      rel: "manual",
    },
  },
  "group.user.deactivated": {
    schema: GroupMembershipPayload,
    summary: "A user was removed from a group.",
    example: {
      userId: "01HXYUSER000000000000000000",
      groupId: "01HXYGROUP00000000000000000",
      rel: "manual",
    },
  },
} as const;
