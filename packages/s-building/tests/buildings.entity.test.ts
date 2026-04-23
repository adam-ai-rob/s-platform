import { describe, expect, test } from "bun:test";
import {
  Address,
  Building,
  CreateBuildingInput,
  CurrencyCode,
  LanguageCode,
  Timezone,
  UpdateBuildingInput,
} from "../core/src/buildings/buildings.entity";

/**
 * Pure Zod shape tests — no DynamoDB, no network.
 */

const VALID_ADDRESS = {
  formatted: "Karlínské nám. 5, 186 00 Praha 8, Czech Republic",
  streetAddress: "Karlínské nám. 5",
  locality: "Praha",
  postalCode: "186 00",
  countryCode: "CZ",
  location: { lat: 50.0917, lng: 14.4547 },
};

const VALID_INPUT = {
  name: "Karlín Tower",
  description: "Office building in Karlín district",
  address: VALID_ADDRESS,
  areaSqm: 4200,
  population: 350,
  primaryLanguage: "cs",
  supportedLanguages: ["cs", "en"],
  currency: "CZK",
  timezone: "Europe/Prague",
};

describe("LanguageCode (BCP-47)", () => {
  test.each([["en"], ["en-GB"], ["zh-Hant-TW"], ["cs"], ["sr-Latn-RS"]])("accepts %s", (code) => {
    expect(LanguageCode.safeParse(code).success).toBe(true);
  });

  test.each([[""], ["en_GB"], ["123"], [" en "], ["en-"]])("rejects %s", (code) => {
    expect(LanguageCode.safeParse(code).success).toBe(false);
  });
});

describe("CurrencyCode (ISO 4217)", () => {
  test.each([["USD"], ["EUR"], ["CZK"], ["JPY"]])("accepts %s", (code) => {
    expect(CurrencyCode.safeParse(code).success).toBe(true);
  });

  test.each([["usd"], ["DOLLAR"], [""], ["US"], ["USDX"]])("rejects %s", (code) => {
    expect(CurrencyCode.safeParse(code).success).toBe(false);
  });
});

describe("Timezone (IANA)", () => {
  test.each([["Europe/Prague"], ["America/New_York"], ["Asia/Ho_Chi_Minh"]])("accepts %s", (tz) => {
    expect(Timezone.safeParse(tz).success).toBe(true);
  });

  test.each([[""], ["UTC"], ["Europe Prague"], ["prague"]])("rejects %s", (tz) => {
    // UTC has no slash; `Europe Prague` has whitespace; `prague` lacks
    // the Area/Location split. The regex deliberately permits `+`, `-`,
    // and digits inside the Location part — `Etc/GMT+5` is a real zone.
    expect(Timezone.safeParse(tz).success).toBe(false);
  });
});

describe("Address", () => {
  test("accepts the full happy shape", () => {
    expect(Address.safeParse(VALID_ADDRESS).success).toBe(true);
  });

  test("accepts the minimal shape (no optional fields)", () => {
    expect(
      Address.safeParse({
        formatted: "123 Main St, New York, NY 10001, USA",
        streetAddress: "123 Main St",
        locality: "New York",
        countryCode: "US",
      }).success,
    ).toBe(true);
  });

  test("rejects a lowercase country code", () => {
    expect(Address.safeParse({ ...VALID_ADDRESS, countryCode: "cz" }).success).toBe(false);
  });

  test("rejects a latitude out of range", () => {
    expect(Address.safeParse({ ...VALID_ADDRESS, location: { lat: 91, lng: 0 } }).success).toBe(
      false,
    );
  });

  test("rejects a missing locality", () => {
    const { locality: _omit, ...rest } = VALID_ADDRESS;
    expect(Address.safeParse(rest).success).toBe(false);
  });
});

describe("CreateBuildingInput", () => {
  test("accepts a valid input", () => {
    expect(CreateBuildingInput.safeParse(VALID_INPUT).success).toBe(true);
  });

  test("rejects when supportedLanguages does not include primaryLanguage", () => {
    const bad = { ...VALID_INPUT, primaryLanguage: "fr", supportedLanguages: ["cs", "en"] };
    const result = CreateBuildingInput.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "supportedLanguages")).toBe(true);
    }
  });

  test("rejects when supportedLanguages has duplicates", () => {
    const bad = { ...VALID_INPUT, supportedLanguages: ["cs", "cs", "en"] };
    expect(CreateBuildingInput.safeParse(bad).success).toBe(false);
  });

  test("rejects when areaSqm is negative", () => {
    expect(CreateBuildingInput.safeParse({ ...VALID_INPUT, areaSqm: -1 }).success).toBe(false);
  });

  test("rejects when population is non-integer", () => {
    expect(CreateBuildingInput.safeParse({ ...VALID_INPUT, population: 2.5 }).success).toBe(false);
  });

  test("rejects when supportedLanguages is empty", () => {
    expect(CreateBuildingInput.safeParse({ ...VALID_INPUT, supportedLanguages: [] }).success).toBe(
      false,
    );
  });

  test("accepts an explicit status", () => {
    expect(CreateBuildingInput.safeParse({ ...VALID_INPUT, status: "active" }).success).toBe(true);
  });

  test("rejects an unknown status", () => {
    expect(CreateBuildingInput.safeParse({ ...VALID_INPUT, status: "deleted" }).success).toBe(
      false,
    );
  });
});

describe("UpdateBuildingInput", () => {
  test("accepts an empty patch", () => {
    expect(UpdateBuildingInput.safeParse({}).success).toBe(true);
  });

  test("accepts a single-field patch", () => {
    expect(UpdateBuildingInput.safeParse({ name: "New Name" }).success).toBe(true);
  });

  test("does NOT accept status (use :archive / :activate actions)", () => {
    // The schema doesn't declare `status`. Zod strips unknown keys by
    // default, so the patch parses but without the status field — that
    // matches the intent: callers using PATCH to change status will
    // silently get a no-op, which is surprising but correct relative to
    // the plan decision. A stricter `.strict()` would throw; we keep
    // the default for forward-compat with partial patches.
    const result = UpdateBuildingInput.safeParse({ status: "archived" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("status" in result.data).toBe(false);
    }
  });
});

describe("Building (full entity)", () => {
  test("accepts a fully-formed row", () => {
    const b = {
      buildingId: "01HXBLD000000000000000000B",
      ...VALID_INPUT,
      status: "active" as const,
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      createdAtMs: 1745366400000,
      updatedAtMs: 1745366400000,
    };
    expect(Building.safeParse(b).success).toBe(true);
  });
});
