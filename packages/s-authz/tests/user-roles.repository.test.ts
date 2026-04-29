import { afterEach, describe, expect, test } from "bun:test";

process.env.AUTHZ_USER_ROLES_TABLE_NAME ??= "AuthzUserRoles-unit-test";

type AuthzUserRole = import("../core/src/user-roles/user-roles.entity").AuthzUserRole;

const { MAX_USER_ROLE_ASSIGNMENTS } = await import("../core/src/user-roles/user-roles.entity");
const { authzUserRolesRepository } = await import("../core/src/user-roles/user-roles.repository");

const originalQueryByIndex = authzUserRolesRepository.queryByIndex.bind(authzUserRolesRepository);

function assignment(index: number): AuthzUserRole {
  return {
    id: `assignment-${index}`,
    userId: "user-1",
    roleId: `role-${index}`,
    createdAt: "2026-04-29T00:00:00.000Z",
    createdBy: "admin",
  };
}

function stubPages(
  pages: Array<{ items: AuthzUserRole[]; nextToken?: string }>,
): Array<{ limit?: number; nextToken?: string }> {
  const calls: Array<{ limit?: number; nextToken?: string }> = [];
  const queue = [...pages];

  // biome-ignore lint/suspicious/noExplicitAny: test-local repository stub
  (authzUserRolesRepository as any).queryByIndex = async (
    _indexName: string,
    _partitionKeyName: string,
    _partitionKeyValue: string,
    options: { limit?: number; nextToken?: string },
  ) => {
    calls.push({ limit: options.limit, nextToken: options.nextToken });
    const page = queue.shift();
    if (!page) return { items: [] };
    return page;
  };

  return calls;
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test-local repository stub restore
  (authzUserRolesRepository as any).queryByIndex = originalQueryByIndex;
});

describe("AuthzUserRolesRepository.listByUserBounded", () => {
  test("exactly the assignment cap is accepted", async () => {
    const calls = stubPages([
      {
        items: Array.from({ length: MAX_USER_ROLE_ASSIGNMENTS }, (_, i) => assignment(i)),
      },
    ]);

    const result = await authzUserRolesRepository.listByUserBounded("user-1");

    expect(result.items).toHaveLength(MAX_USER_ROLE_ASSIGNMENTS);
    expect(result.observedCount).toBe(MAX_USER_ROLE_ASSIGNMENTS);
    expect(result.overLimit).toBe(false);
    expect(calls).toEqual([{ limit: MAX_USER_ROLE_ASSIGNMENTS + 1, nextToken: undefined }]);
  });

  test("one assignment over the cap is reported without returning the extra row", async () => {
    stubPages([
      {
        items: Array.from({ length: MAX_USER_ROLE_ASSIGNMENTS + 1 }, (_, i) => assignment(i)),
      },
    ]);

    const result = await authzUserRolesRepository.listByUserBounded("user-1");

    expect(result.items).toHaveLength(MAX_USER_ROLE_ASSIGNMENTS);
    expect(result.observedCount).toBe(MAX_USER_ROLE_ASSIGNMENTS + 1);
    expect(result.overLimit).toBe(true);
  });

  test("pagination stops as soon as the extra cap-check row is observed", async () => {
    const calls = stubPages([
      {
        items: Array.from({ length: 60 }, (_, i) => assignment(i)),
        nextToken: "page-2",
      },
      {
        items: Array.from({ length: 41 }, (_, i) => assignment(60 + i)),
        nextToken: "page-3",
      },
    ]);

    const result = await authzUserRolesRepository.listByUserBounded("user-1");

    expect(result.observedCount).toBe(MAX_USER_ROLE_ASSIGNMENTS + 1);
    expect(result.overLimit).toBe(true);
    expect(calls).toEqual([
      { limit: MAX_USER_ROLE_ASSIGNMENTS + 1, nextToken: undefined },
      { limit: 41, nextToken: "page-2" },
    ]);
  });
});

describe("AuthzUserRolesRepository.findByUserAndRole", () => {
  test("continues scanning pages so over-cap users can delete a target assignment", async () => {
    const target = { ...assignment(120), roleId: "target-role" };
    const calls = stubPages([
      {
        items: Array.from({ length: MAX_USER_ROLE_ASSIGNMENTS + 1 }, (_, i) => assignment(i)),
        nextToken: "page-2",
      },
      {
        items: [target],
      },
    ]);

    const result = await authzUserRolesRepository.findByUserAndRole("user-1", "target-role");

    expect(result).toEqual(target);
    expect(calls).toEqual([
      { limit: MAX_USER_ROLE_ASSIGNMENTS + 1, nextToken: undefined },
      { limit: MAX_USER_ROLE_ASSIGNMENTS + 1, nextToken: "page-2" },
    ]);
  });
});
