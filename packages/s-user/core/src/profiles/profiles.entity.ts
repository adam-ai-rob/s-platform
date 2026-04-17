/**
 * UserProfile — profile data keyed by the user's identity ULID from s-authn.
 *
 * Creation is triggered by a `user.registered` event, not by HTTP. The
 * profile row starts with empty strings for firstName / lastName —
 * users fill them via PATCH /user/me.
 */
export interface UserProfile {
  userId: string; // = AuthnUser.id — partition key
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  preferences: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export type UserProfileKeys = { userId: string };

export function createEmptyProfile(userId: string): UserProfile {
  const now = new Date().toISOString();
  return {
    userId,
    firstName: "",
    lastName: "",
    preferences: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}
