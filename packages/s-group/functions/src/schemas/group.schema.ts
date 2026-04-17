import { z } from "@hono/zod-openapi";

export const GroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(["company", "team", "building"]).optional(),
    emailDomainNames: z.array(z.string()),
    automaticUserAssignment: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Group");

export const GroupResponse = z.object({ data: GroupSchema }).openapi("GroupResponse");

export const CreateGroupBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    type: z.enum(["company", "team", "building"]).optional(),
    emailDomainNames: z.array(z.string()).default([]),
    automaticUserAssignment: z.boolean().default(true),
  })
  .openapi("CreateGroupBody");

export const MembershipSchema = z
  .object({
    id: z.string(),
    groupId: z.string(),
    userId: z.string(),
    rel: z.enum(["owner", "manual", "domain", "group"]),
    status: z.enum(["active", "pending", "rejected"]),
    addedBy: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Membership");

export const MembershipListResponse = z
  .object({ data: z.array(MembershipSchema) })
  .openapi("MembershipListResponse");
