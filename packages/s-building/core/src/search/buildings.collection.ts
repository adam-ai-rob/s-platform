import type { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
import type { Building } from "../buildings/buildings.entity";

/**
 * Typesense `buildings` collection schema (v1).
 *
 * Scope — every field s-building owns that's useful to filter, facet,
 * or sort by. Nested address is projected to flat facetable fields
 * (`countryCode`, `locality`, `region`) so the Typesense grammar can
 * talk about them without diving into JSON paths.
 *
 * The `id` field is Typesense's primary key (required to be a string) —
 * we map it 1:1 from `buildingId`. `id` also drives the scoped
 * `id:=[...]` filter that gates non-superadmin list calls; see
 * `docs/architecture/09-api-conventions.md` and
 * `packages/s-building/CLAUDE.md`.
 */

export const BUILDINGS_ENTITY = "buildings";

export interface BuildingSearchDocument {
  id: string;
  name: string;
  status: Building["status"];
  countryCode: string;
  locality: string;
  /** Optional on the wire — omitted when the address lacks a region. */
  region?: string;
  createdAtMs: number;
  updatedAtMs: number;
  areaSqm: number;
  population: number;
}

export function buildingsCollectionSchema(collectionName: string): CollectionCreateSchema {
  return {
    name: collectionName,
    fields: [
      // NB: Typesense does NOT permit declaring `id` here — it's the
      // implicit primary key, auto-indexed, and silently stripped.
      // It IS filterable (which is exactly what the scoped `id:=[...]`
      // gate needs), just not sortable — cursor tiebreak uses
      // `filter_by id:!=…` instead of `sort_by id:…`.
      { name: "name", type: "string", sort: true },
      { name: "status", type: "string", facet: true },
      { name: "countryCode", type: "string", facet: true },
      { name: "locality", type: "string", facet: true },
      { name: "region", type: "string", facet: true, optional: true },
      { name: "createdAtMs", type: "int64", sort: true },
      { name: "updatedAtMs", type: "int64", sort: true },
      { name: "areaSqm", type: "int64", sort: true },
      { name: "population", type: "int64", sort: true },
    ],
    default_sorting_field: "createdAtMs",
    enable_nested_fields: false,
  };
}

/**
 * Project a Building row into a Typesense search document.
 *
 * Pure. No I/O. Lives in core so the indexer Lambda and the backfill
 * Lambda share a single mapping.
 */
export function buildingToSearchDocument(building: Building): BuildingSearchDocument {
  const doc: BuildingSearchDocument = {
    id: building.buildingId,
    name: building.name,
    status: building.status,
    countryCode: building.address.countryCode,
    locality: building.address.locality,
    createdAtMs: building.createdAtMs,
    updatedAtMs: building.updatedAtMs,
    // Typesense requires int64 — round the (already integer by schema)
    // areaSqm defensively in case a float ever slips through.
    areaSqm: Math.round(building.areaSqm),
    population: building.population,
  };
  if (building.address.region) doc.region = building.address.region;
  return doc;
}
