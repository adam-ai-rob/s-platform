/**
 * Building event catalog.
 *
 * Populated by sub-issue #67 — the DDB stream handler that publishes
 * `building.{created,updated,activated,archived,deleted}` will declare
 * its payload schemas here, and `scripts/build-contracts.ts` will emit
 * them as an AsyncAPI document.
 *
 * Empty on purpose today so #65 (scaffold) can land independently and
 * contract-diff passes.
 */
import type { z } from "zod";

export const buildingEventCatalog: Record<
  string,
  { schema: z.ZodTypeAny; summary: string; example: unknown }
> = {};
