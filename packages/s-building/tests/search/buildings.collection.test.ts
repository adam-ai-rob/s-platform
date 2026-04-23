import { describe, expect, test } from "bun:test";
import type { Building } from "../../core/src/buildings/buildings.entity";
import {
  buildingToSearchDocument,
  buildingsCollectionSchema,
} from "../../core/src/search/buildings.collection";

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    buildingId: "01HXYBUILDING00000000000000",
    name: "Karlín Tower",
    description: "Office building in Karlín district",
    address: {
      formatted: "Karlínské nám. 5, 186 00 Praha 8, Czech Republic",
      streetAddress: "Karlínské nám. 5",
      locality: "Praha",
      region: "Hlavní město Praha",
      postalCode: "186 00",
      countryCode: "CZ",
      location: { lat: 50.0917, lng: 14.4547 },
    },
    areaSqm: 4200,
    population: 350,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "EUR",
    timezone: "Europe/Prague",
    status: "active",
    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T09:00:00.000Z",
    createdAtMs: 1_745_136_000_000,
    updatedAtMs: 1_745_139_600_000,
    ...overrides,
  };
}

describe("buildingToSearchDocument", () => {
  test("maps a complete building, projecting address fields to the top level", () => {
    const doc = buildingToSearchDocument(makeBuilding());
    expect(doc).toEqual({
      id: "01HXYBUILDING00000000000000",
      name: "Karlín Tower",
      status: "active",
      countryCode: "CZ",
      locality: "Praha",
      region: "Hlavní město Praha",
      createdAtMs: 1_745_136_000_000,
      updatedAtMs: 1_745_139_600_000,
      areaSqm: 4200,
      population: 350,
    });
  });

  test("omits region when the address has none", () => {
    const doc = buildingToSearchDocument(
      makeBuilding({
        address: {
          formatted: "1 Example St",
          streetAddress: "1 Example St",
          locality: "London",
          countryCode: "GB",
        },
      }),
    );
    expect("region" in doc).toBe(false);
  });

  test("rounds areaSqm defensively when the row carries a float", () => {
    // The Zod entity constrains areaSqm to number — no .int() — so a
    // float could theoretically land in DDB. Typesense requires int64;
    // rounding is safer than failing to index the row.
    const doc = buildingToSearchDocument(makeBuilding({ areaSqm: 4200.7 }));
    expect(doc.areaSqm).toBe(4201);
    expect(Number.isInteger(doc.areaSqm)).toBe(true);
  });

  test("drops region when it is set to an empty string", () => {
    const doc = buildingToSearchDocument(
      makeBuilding({
        address: {
          formatted: "1 Example St",
          streetAddress: "1 Example St",
          locality: "London",
          region: "",
          countryCode: "GB",
        },
      }),
    );
    expect("region" in doc).toBe(false);
  });
});

describe("buildingsCollectionSchema", () => {
  test("embeds the collection name from the caller", () => {
    expect(buildingsCollectionSchema("prod_buildings").name).toBe("prod_buildings");
  });

  test("uses createdAtMs as default sort", () => {
    expect(buildingsCollectionSchema("dev_buildings").default_sorting_field).toBe("createdAtMs");
  });

  test("declares the facet-able fields with facet: true", () => {
    const schema = buildingsCollectionSchema("dev_buildings");
    const facets = (schema.fields ?? []).filter((f) => f.facet === true).map((f) => f.name);
    expect(facets).toEqual(["status", "countryCode", "locality", "region"]);
  });

  test("declares numeric fields as sortable int64", () => {
    const schema = buildingsCollectionSchema("dev_buildings");
    const numeric = (schema.fields ?? []).filter(
      (f) => f.name === "createdAtMs" || f.name === "areaSqm" || f.name === "population",
    );
    for (const f of numeric) {
      expect(f.type).toBe("int64");
      expect(f.sort).toBe(true);
    }
  });

  test("does NOT declare `id` — it's Typesense's implicit primary key", () => {
    const schema = buildingsCollectionSchema("dev_buildings");
    expect((schema.fields ?? []).some((f) => f.name === "id")).toBe(false);
  });
});
