import { ulid } from "ulid";

export interface AuthzUserRole {
  id: string; // ULID
  userId: string;
  roleId: string;
  createdAt: string;
  createdBy: string;
}

export type AuthzUserRoleKeys = { id: string };

export function createAuthzUserRole(params: {
  userId: string;
  roleId: string;
  createdBy: string;
}): AuthzUserRole {
  return {
    id: ulid(),
    userId: params.userId,
    roleId: params.roleId,
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
  };
}
