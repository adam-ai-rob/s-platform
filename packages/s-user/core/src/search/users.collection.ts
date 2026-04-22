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

/**
 * Wire shape of a user document in Typesense. The `id` here is the
 * Typesense primary-key field (= the s-authn userId) — Typesense
 * silently strips any `{name: "id"}` from `fields[]` because `id` is
 * reserved and auto-indexed, so it appears on the document TS type
 * but NEVER in the collection schema. Keep them in sync: if you add
 * a property here, add a matching `fields[]` entry below.
 */
export interface UserSearchDocument {
  id: string; // == userId — Typesense primary key, auto-indexed, not in `fields`
  firstName: string;
  lastName: string;
  displayName: string;
  /** Optional on the wire — omitted from the document when profile has no avatar. */
  avatarUrl?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export function usersCollectionSchema(collectionName: string): CollectionCreateSchema {
  return {
    name: collectionName,
    fields: [
      // NB: Typesense does NOT permit declaring `id` here — it's
      // reserved as the implicit primary key and silently stripped.
      // `id` therefore can't be used as a `sort_by` tiebreaker; the
      // cursor codec instead uses `filter_by id:!=…` (id IS filterable
      // even when not sortable) to disambiguate duplicate sort values.
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
  // Omit `avatarUrl` entirely when the profile has none. Typesense's
  // `optional: true` field config means a missing key is the "no value"
  // state; storing `""` would merge with empty-avatar and have-avatar
  // users under the same filter, which complicates later faceting.
  const doc: UserSearchDocument = {
    id: profile.userId,
    firstName,
    lastName,
    displayName: buildDisplayName(firstName, lastName, profile.userId),
    createdAtMs: Date.parse(profile.createdAt),
    updatedAtMs: Date.parse(profile.updatedAt),
  };
  if (profile.avatarUrl) doc.avatarUrl = profile.avatarUrl;
  return doc;
}

function buildDisplayName(firstName: string, lastName: string, userId: string): string {
  const combined = `${firstName} ${lastName}`.trim();
  return combined.length > 0 ? combined : userId;
}
