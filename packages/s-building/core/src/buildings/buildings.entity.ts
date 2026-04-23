import { z } from "zod";

/**
 * Building — a physical location with scoped permissions.
 *
 * Source of truth is the DynamoDB row; everything serialised through
 * the API matches this schema exactly (with ISO timestamps surfaced
 * alongside their `*Ms` int64 counterparts per the v1 REST conventions).
 */

// BCP-47 language tag — permissive pattern that accepts primary (`en`),
// region (`en-GB`), and extended subtags (`zh-Hant-TW`). Rejects common
// accidents like underscores, trailing whitespace, or leading numerals.
const BCP47 = /^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$/;

// IANA time zone — Area/Location with optional "_Underscore" / slashes
// and no whitespace. Delegate strict validation to the runtime so we
// don't ship an out-of-date region list with the code.
const IANA_TZ = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/;

export const LanguageCode = z
  .string()
  .min(2)
  .max(35)
  .regex(BCP47, "Expected BCP-47 language tag (e.g. 'en', 'en-GB', 'zh-Hant-TW')");

export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Expected ISO 4217 alpha-3 code (e.g. 'USD', 'EUR', 'CZK')");

export const Timezone = z
  .string()
  .min(3)
  .max(64)
  .regex(IANA_TZ, "Expected IANA time zone (e.g. 'Europe/Prague', 'America/New_York')");

export const CountryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "Expected ISO 3166-1 alpha-2 code (e.g. 'CZ', 'US')");

export const Address = z.object({
  formatted: z.string().min(1).max(500),
  streetAddress: z.string().min(1).max(200),
  extendedAddress: z.string().max(200).optional(),
  locality: z.string().min(1).max(100),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  countryCode: CountryCode,
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});
export type Address = z.infer<typeof Address>;

export const BuildingStatus = z.enum(["draft", "active", "archived"]);
export type BuildingStatus = z.infer<typeof BuildingStatus>;

export const Building = z
  .object({
    buildingId: z.string().min(1),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    address: Address,
    areaSqm: z.number().min(0),
    population: z.number().int().min(0),
    primaryLanguage: LanguageCode,
    supportedLanguages: z
      .array(LanguageCode)
      .min(1)
      .max(50)
      .refine((langs) => new Set(langs).size === langs.length, {
        message: "supportedLanguages must be unique",
      }),
    currency: CurrencyCode,
    timezone: Timezone,
    status: BuildingStatus,
    createdAt: z.string(),
    updatedAt: z.string(),
    createdAtMs: z.number().int(),
    updatedAtMs: z.number().int(),
  })
  .superRefine((b, ctx) => {
    if (!b.supportedLanguages.includes(b.primaryLanguage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedLanguages"],
        message: `supportedLanguages must include primaryLanguage (${b.primaryLanguage})`,
      });
    }
  });
export type Building = z.infer<typeof Building>;

export type BuildingKeys = { buildingId: string };

/**
 * Input schema for `createBuilding` — same shape as the entity minus
 * the fields the service assigns itself (`buildingId`, timestamps).
 * `status` defaults to `draft` in the service if omitted.
 */
export const CreateBuildingInput = z
  .object({
    name: Building.innerType().shape.name,
    description: Building.innerType().shape.description,
    address: Address,
    areaSqm: Building.innerType().shape.areaSqm,
    population: Building.innerType().shape.population,
    primaryLanguage: LanguageCode,
    supportedLanguages: Building.innerType().shape.supportedLanguages,
    currency: CurrencyCode,
    timezone: Timezone,
    status: BuildingStatus.optional(),
  })
  .superRefine((b, ctx) => {
    if (!b.supportedLanguages.includes(b.primaryLanguage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedLanguages"],
        message: `supportedLanguages must include primaryLanguage (${b.primaryLanguage})`,
      });
    }
  });
export type CreateBuildingInput = z.infer<typeof CreateBuildingInput>;

/**
 * Input schema for `updateBuilding`. Every field is optional (PATCH
 * semantics). `status` is NOT in this schema — use the `:archive` /
 * `:activate` custom actions to transition state so stream-handler can
 * distinguish a plain update from a status transition.
 */
export const UpdateBuildingInput = z.object({
  name: Building.innerType().shape.name.optional(),
  description: Building.innerType().shape.description,
  address: Address.optional(),
  areaSqm: Building.innerType().shape.areaSqm.optional(),
  population: Building.innerType().shape.population.optional(),
  primaryLanguage: LanguageCode.optional(),
  supportedLanguages: Building.innerType().shape.supportedLanguages.optional(),
  currency: CurrencyCode.optional(),
  timezone: Timezone.optional(),
});
export type UpdateBuildingInput = z.infer<typeof UpdateBuildingInput>;
