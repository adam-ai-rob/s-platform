import type { CollectionCreateSchema } from "typesense/lib/Typesense/Collections";
import type { UserProfile } from "../profiles/profiles.entity";

/**
 * Typesense `users` collection schema (v1).
 *
 * Scope — only fields s-user actually owns today (names, timestamps).
 * Facet-able categoricals (status, role, tenant, department) live in
 * sibling modules and are deferred until we can cleanly denormalize them
 * via events; see ADR `docs/architecture/adr/typesense-search.md`.
 *
 * The `id` field is Typesense's primary key (required to be a string) —
 * we map it 1:1 from `userId`.
 */

export const USERS_ENTITY = "users";

export interface UserSearchDocument {
  id: string; // == userId
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export function usersCollectionSchema(collectionName: string): CollectionCreateSchema {
  return {
    name: collectionName,
    fields: [
      { name: "firstName", type: "string", sort: true },
      { name: "lastName", type: "string", sort: true },
      { name: "displayName", type: "string", sort: true },
      { name: "avatarUrl", type: "string", index: false, optional: true },
      { name: "createdAtMs", type: "int64", sort: true },
      { name: "updatedAtMs", type: "int64", sort: true },
    ],
    default_sorting_field: "createdAtMs",
    enable_nested_fields: false,
  };
}

/**
 * Project a DynamoDB UserProfile row into a Typesense search document.
 *
 * Pure. No I/O. Lives in core so the indexer Lambda and the backfill
 * script share a single mapping.
 */
export function profileToSearchDocument(profile: UserProfile): UserSearchDocument {
  const firstName = profile.firstName ?? "";
  const lastName = profile.lastName ?? "";
  return {
    id: profile.userId,
    firstName,
    lastName,
    displayName: buildDisplayName(firstName, lastName, profile.userId),
    avatarUrl: profile.avatarUrl ?? "",
    createdAtMs: Date.parse(profile.createdAt),
    updatedAtMs: Date.parse(profile.updatedAt),
  };
}

function buildDisplayName(firstName: string, lastName: string, userId: string): string {
  const combined = `${firstName} ${lastName}`.trim();
  return combined.length > 0 ? combined : userId;
}
