import { BaseRepository, type PaginatedResult } from "@s/shared/ddb";
import type { Group, GroupKeys } from "./groups.entity";

function tableName(): string {
  const name = process.env.GROUPS_TABLE_NAME;
  if (!name) throw new Error("GROUPS_TABLE_NAME env var not set");
  return name;
}

class GroupsRepository extends BaseRepository<Group, GroupKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "id" },
    });
  }

  async findById(id: string): Promise<Group | undefined> {
    return this.get(id);
  }

  async findByName(name: string): Promise<Group | undefined> {
    const { items } = await this.queryByIndex("ByName", "name", name, { limit: 1 });
    return items[0];
  }

  async insert(group: Group): Promise<void> {
    await this.put(group, { condition: "attribute_not_exists(id)" });
  }

  async list(options: { limit?: number; nextToken?: string }): Promise<PaginatedResult<Group>> {
    return this.queryByIndex("ByName", "name", "", options);
  }

  /**
   * Hot path for the user.registered event handler — scans for groups
   * that match an email domain. Phase 1 uses a scan because the group
   * catalog is small; Phase 2 should add a sparse GSI keyed by domain.
   */
  async listAutoAssignGroups(): Promise<Group[]> {
    const results: Group[] = [];
    let nextToken: string | undefined;
    do {
      const res = await this.queryByIndex("ByName", "name", "", {
        limit: 100,
        nextToken,
      });
      for (const g of res.items) {
        if (g.automaticUserAssignment && g.emailDomainNames.length > 0) {
          results.push(g);
        }
      }
      nextToken = res.nextToken;
    } while (nextToken);
    return results;
  }
}

export const groupsRepository = new GroupsRepository();
