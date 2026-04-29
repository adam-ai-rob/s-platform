import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { BaseRepository, type PaginatedResult, getDdbClient } from "@s/shared/ddb";
import type { AuthzRole, AuthzRoleKeys } from "./roles.entity";

// DynamoDB BatchGetItem caps at 100 keys per request.
const BATCH_GET_CHUNK_SIZE = 100;
// Bounded retry for UnprocessedKeys (throttling). Throttling is rare for
// our workload; an exponential backoff would be overkill.
const BATCH_GET_MAX_ATTEMPTS = 5;

function tableName(): string {
  const name = process.env.AUTHZ_ROLES_TABLE_NAME;
  if (!name) throw new Error("AUTHZ_ROLES_TABLE_NAME env var not set");
  return name;
}

class AuthzRolesRepository extends BaseRepository<AuthzRole, AuthzRoleKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(id: string): Promise<AuthzRole | undefined> {
    return this.get(id);
  }

  /**
   * Bulk role lookup keyed by id. Used by `AuthzView` rebuild to avoid an
   * N+1 round-trip when a user has multiple assignments referencing the
   * same role (or many distinct roles). Missing ids are absent from the
   * returned map.
   *
   * Throws if `UnprocessedKeys` survives `BATCH_GET_MAX_ATTEMPTS` retries —
   * silently dropping roles would corrupt the materialized view.
   */
  async findByIds(ids: readonly string[]): Promise<Map<string, AuthzRole>> {
    const out = new Map<string, AuthzRole>();
    if (ids.length === 0) return out;

    const unique = Array.from(new Set(ids));

    for (let i = 0; i < unique.length; i += BATCH_GET_CHUNK_SIZE) {
      let keys: { id: string }[] = unique.slice(i, i + BATCH_GET_CHUNK_SIZE).map((id) => ({ id }));

      for (let attempt = 0; attempt < BATCH_GET_MAX_ATTEMPTS && keys.length > 0; attempt++) {
        const res = await getDdbClient().send(
          new BatchGetCommand({
            RequestItems: { [this.tableName]: { Keys: keys } },
          }),
        );
        for (const item of res.Responses?.[this.tableName] ?? []) {
          const role = item as AuthzRole;
          out.set(role.id, role);
        }
        keys = (res.UnprocessedKeys?.[this.tableName]?.Keys as { id: string }[] | undefined) ?? [];
      }

      if (keys.length > 0) {
        throw new Error(
          `AuthzRolesRepository.findByIds: ${keys.length} unprocessed keys after ${BATCH_GET_MAX_ATTEMPTS} attempts`,
        );
      }
    }

    return out;
  }

  async findByName(name: string): Promise<AuthzRole | undefined> {
    const { items } = await this.queryByIndex("ByName", "name", name, { limit: 1 });
    return items[0];
  }

  async insert(role: AuthzRole): Promise<void> {
    await this.put(role, { condition: "attribute_not_exists(id)" });
  }

  async update(id: string, patch: Partial<Omit<AuthzRole, "id" | "createdAt">>): Promise<void> {
    await this.patch(id, undefined, { ...patch, updatedAt: new Date().toISOString() });
  }

  async list(options: { limit?: number; nextToken?: string }): Promise<PaginatedResult<AuthzRole>> {
    // GSI scan via ByName. For a true "list all" we'd use a sparse full-table
    // attribute, but Phase 1 treats role catalog as small enough to scan.
    return this.queryByIndex("ByName", "name", "", options);
  }
}

export const authzRolesRepository = new AuthzRolesRepository();
