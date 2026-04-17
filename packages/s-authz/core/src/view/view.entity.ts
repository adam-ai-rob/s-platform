import type { Permission } from "@s/shared/types";

/**
 * AuthzView — flat materialized permission list per user.
 *
 * This is the "hot path" lookup for every other module's auth middleware.
 * Keyed by userId, stores the pre-aggregated permissions list. Rebuilt
 * by the event-handler Lambda on any relevant role or membership change.
 *
 * When a user has no roles, this record contains `permissions: []` —
 * NOT absent — so that auth middleware can distinguish "user exists
 * but has nothing" from "user not set up yet".
 */
export interface AuthzViewEntry {
  userId: string;
  permissions: Permission[];
  updatedAt: string;
}

export type AuthzViewEntryKeys = { userId: string };
