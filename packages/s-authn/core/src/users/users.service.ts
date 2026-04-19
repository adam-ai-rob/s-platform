import { UserNotFoundError } from "../shared/errors";
import type { AuthnUser } from "./users.entity";
import { authnUsersRepository } from "./users.repository";

export async function getUserById(id: string): Promise<AuthnUser> {
  const user = await authnUsersRepository.findById(id);
  if (!user) throw new UserNotFoundError();
  return user;
}

export async function findUserByEmail(email: string): Promise<AuthnUser | undefined> {
  return authnUsersRepository.findByEmail(email);
}
