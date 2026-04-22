import { describe, expect, test } from "bun:test";
import type { UserProfile } from "../../core/src/profiles/profiles.entity";
import {
  profileToSearchDocument,
  usersCollectionSchema,
} from "../../core/src/search/users.collection";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "01HXYZ000000000000000000AB",
    firstName: "Ada",
    lastName: "Lovelace",
    avatarUrl: undefined,
    preferences: {},
    metadata: {},
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:30:00.000Z",
    ...overrides,
  };
}

describe("profileToSearchDocument", () => {
  test("maps a complete profile", () => {
    const doc = profileToSearchDocument(makeProfile());
    expect(doc).toEqual({
      id: "01HXYZ000000000000000000AB",
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      avatarUrl: "",
      createdAtMs: Date.parse("2026-04-22T08:00:00.000Z"),
      updatedAtMs: Date.parse("2026-04-22T08:30:00.000Z"),
    });
  });

  test("falls back to userId when both names are empty", () => {
    const doc = profileToSearchDocument(makeProfile({ firstName: "", lastName: "" }));
    expect(doc.displayName).toBe("01HXYZ000000000000000000AB");
  });

  test("trims the display name when only one name is present", () => {
    const firstOnly = profileToSearchDocument(makeProfile({ lastName: "" }));
    expect(firstOnly.displayName).toBe("Ada");
    const lastOnly = profileToSearchDocument(makeProfile({ firstName: "" }));
    expect(lastOnly.displayName).toBe("Lovelace");
  });

  test("copies avatarUrl when present", () => {
    const doc = profileToSearchDocument(makeProfile({ avatarUrl: "https://cdn.example/a.png" }));
    expect(doc.avatarUrl).toBe("https://cdn.example/a.png");
  });
});

describe("usersCollectionSchema", () => {
  test("marks name fields as sortable strings", () => {
    const schema = usersCollectionSchema("dev_users");
    const first = schema.fields?.find((f) => f.name === "firstName");
    expect(first?.type).toBe("string");
    expect(first?.sort).toBe(true);
  });

  test("uses createdAtMs as default sort", () => {
    const schema = usersCollectionSchema("dev_users");
    expect(schema.default_sorting_field).toBe("createdAtMs");
  });

  test("embeds the collection name from the caller", () => {
    expect(usersCollectionSchema("prod_users").name).toBe("prod_users");
  });
});
