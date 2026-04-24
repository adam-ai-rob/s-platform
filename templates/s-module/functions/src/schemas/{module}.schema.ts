import { z } from "@hono/zod-openapi";
import { ListResponse, SingleResponse } from "@s/shared/types";

const Iso8601 = z.string().openapi({
  format: "date-time",
  example: "2026-04-22T08:00:00.000Z",
});

const Int64 = z.number().int().openapi({ format: "int64" });

export const Resource = z
  .object({
    id: z.string().openapi({ example: "01HXYRESOURCE000000000000000" }),
    name: z.string(),
    createdAt: Iso8601,
    updatedAt: Iso8601,
    createdAtMs: Int64,
    updatedAtMs: Int64,
  })
  .openapi("{Module}Resource");

export const ResourceResponse = SingleResponse(Resource).openapi("{Module}Response");

export const ResourceListResponse = ListResponse(Resource).openapi("{Module}ListResponse");

export const CreateResourceBody = z
  .object({
    name: z.string().min(1).max(200),
  })
  .openapi("Create{Module}Body");

export const ListQuery = z.object({
  q: z.string().optional(),
  filter_by: z.string().optional(),
  sort_by: z.string().optional(),
  facet_by: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

export const ResourceIdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({ param: { name: "id", in: "path" } }),
});
