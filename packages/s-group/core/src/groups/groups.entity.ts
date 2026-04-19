import { ulid } from "ulid";

/**
 * Group — a named container that users can belong to.
 *
 * `emailDomainNames` enables auto-assignment: when s-authn publishes
 * `user.registered`, the event handler checks the user's email domain
 * against every group and auto-adds matches (with rel="domain").
 */
export interface Group {
  id: string; // ULID
  name: string;
  description?: string;
  type?: "company" | "team" | "building";
  emailDomainNames: string[]; // lowercased domains, e.g. ["example.com"]
  automaticUserAssignment: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GroupKeys = { id: string };

export function createGroup(params: {
  name: string;
  description?: string;
  type?: "company" | "team" | "building";
  emailDomainNames?: string[];
  automaticUserAssignment?: boolean;
}): Group {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    name: params.name,
    description: params.description,
    type: params.type,
    emailDomainNames: (params.emailDomainNames ?? []).map((d) => d.toLowerCase()),
    automaticUserAssignment: params.automaticUserAssignment ?? true,
    createdAt: now,
    updatedAt: now,
  };
}
