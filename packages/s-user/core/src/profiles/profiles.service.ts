import { isConditionalCheckFailed } from "@s/shared/ddb";
import { NotFoundError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { type UserProfile, createEmptyProfile } from "./profiles.entity";
import { userProfilesRepository } from "./profiles.repository";

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
  preferences?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const profile = await userProfilesRepository.findById(userId);
  if (!profile) throw new NotFoundError(`Profile not found for user ${userId}`);
  return profile;
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfile> {
  const existing = await userProfilesRepository.findById(userId);
  if (!existing) throw new NotFoundError(`Profile not found for user ${userId}`);

  // avatarUrl: null is a sentinel for REMOVE in BaseRepository.patch. Cast
  // to the repo's type signature since null is intentional here.
  await userProfilesRepository.update(
    userId,
    input as Partial<Omit<UserProfile, "userId" | "createdAt">>,
  );
  logger.info("✅ Profile updated", { userId });

  const updated = await userProfilesRepository.findById(userId);
  if (!updated) throw new NotFoundError(`Profile missing after update for ${userId}`);
  return updated;
}

/**
 * Event-driven profile creation from `user.registered`.
 * Idempotent — safe to retry; a second INSERT with the same userId
 * hits the `attribute_not_exists(userId)` condition and is ignored.
 */
export async function handleUserRegistered(payload: {
  userId: string;
  email: string;
}): Promise<void> {
  const profile = createEmptyProfile(payload.userId);
  try {
    await userProfilesRepository.insert(profile);
    logger.info("✅ Profile created from user.registered", {
      userId: payload.userId,
    });
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      logger.info("Profile already exists (idempotent)", { userId: payload.userId });
      return;
    }
    throw err;
  }
}
