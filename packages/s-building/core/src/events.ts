import { z } from "zod";
import { BuildingStatus } from "./buildings/buildings.entity";

/**
 * Building event catalog.
 *
 * Published by `functions/src/stream-handler.ts` off the Buildings DDB
 * stream. Consumers fetch the full entity from DDB (or the Typesense
 * mirror) when they need more than identity — payloads carry only what a
 * router needs so the envelope stays small and late-joining subscribers
 * can't be misled by stale field snapshots.
 *
 * `scripts/build-contracts.ts` serialises these schemas into the
 * AsyncAPI document under `contracts/events.asyncapi.json`.
 */

export const BuildingCreatedPayload = z
  .object({
    buildingId: z.string(),
    status: BuildingStatus,
  })
  .strict();
export type BuildingCreatedPayload = z.infer<typeof BuildingCreatedPayload>;

export const BuildingUpdatedPayload = z
  .object({
    buildingId: z.string(),
  })
  .strict();
export type BuildingUpdatedPayload = z.infer<typeof BuildingUpdatedPayload>;

export const BuildingActivatedPayload = z
  .object({
    buildingId: z.string(),
  })
  .strict();
export type BuildingActivatedPayload = z.infer<typeof BuildingActivatedPayload>;

export const BuildingArchivedPayload = z
  .object({
    buildingId: z.string(),
  })
  .strict();
export type BuildingArchivedPayload = z.infer<typeof BuildingArchivedPayload>;

export const BuildingDeletedPayload = z
  .object({
    buildingId: z.string(),
  })
  .strict();
export type BuildingDeletedPayload = z.infer<typeof BuildingDeletedPayload>;

export const buildingEventCatalog = {
  "building.created": {
    schema: BuildingCreatedPayload,
    summary: "A new Building row was inserted. `status` lets routers skip drafts if they care.",
    example: {
      buildingId: "01HXYBUILDING00000000000000",
      status: "draft",
    },
  },
  "building.updated": {
    schema: BuildingUpdatedPayload,
    summary:
      "A Building row was MODIFIED. Always fires on MODIFY — transition events below are additive.",
    example: {
      buildingId: "01HXYBUILDING00000000000000",
    },
  },
  "building.activated": {
    schema: BuildingActivatedPayload,
    summary: "A Building transitioned to `active` (draft→active or archived→active).",
    example: {
      buildingId: "01HXYBUILDING00000000000000",
    },
  },
  "building.archived": {
    schema: BuildingArchivedPayload,
    summary:
      "A Building transitioned to `archived`. Today the service only exposes active→archived, but the handler fires on any non-archived→archived so defensive raw DDB writes don't slip through.",
    example: {
      buildingId: "01HXYBUILDING00000000000000",
    },
  },
  "building.deleted": {
    schema: BuildingDeletedPayload,
    summary: "A Building row was REMOVED. Consumers should drop any mirror they hold.",
    example: {
      buildingId: "01HXYBUILDING00000000000000",
    },
  },
} as const;
