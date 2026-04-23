import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { BaseRepository, type PaginatedResult, getDdbClient } from "@s/shared/ddb";
import { logger } from "@s/shared/logger";
import { Building, type BuildingKeys, type BuildingStatus } from "./buildings.entity";

function tableName(): string {
  const name = process.env.BUILDINGS_TABLE_NAME;
  if (!name) throw new Error("BUILDINGS_TABLE_NAME env var not set");
  return name;
}

export interface ScanPage {
  items: Building[];
  lastKey?: Record<string, unknown>;
}

class BuildingsRepository extends BaseRepository<Building, BuildingKeys> {
  constructor() {
    super({
      tableName: tableName(),
      keyFields: { partitionKey: "buildingId" },
    });
  }

  async findById(buildingId: string): Promise<Building | undefined> {
    return this.get(buildingId);
  }

  /**
   * Conditional insert — `attribute_not_exists(buildingId)` so
   * `createBuilding` surfaces a conditional-check-failed error if the
   * caller accidentally re-uses an id. Service wraps that into a
   * domain error.
   */
  async insert(building: Building): Promise<void> {
    await this.put(building, { condition: "attribute_not_exists(buildingId)" });
  }

  async update(
    buildingId: string,
    patch: Partial<Omit<Building, "buildingId" | "createdAt" | "createdAtMs">>,
  ): Promise<void> {
    await this.patch(buildingId, undefined, patch);
  }

  async deleteById(buildingId: string): Promise<void> {
    await this.delete(buildingId);
  }

  /**
   * Admin-fallback list by status via the `ByStatus` GSI
   * (`status` hash, `updatedAtMs` range — newest first). Typesense is
   * the primary list path; this is here for operator tooling + tests.
   */
  async listByStatus(
    status: BuildingStatus,
    options: { limit?: number; nextToken?: string } = {},
  ): Promise<PaginatedResult<Building>> {
    return this.queryByIndex("ByStatus", "status", status, {
      ...options,
      scanIndexForward: false,
    });
  }

  /**
   * Full-table scan page. Used by #68's backfill Lambda to seed
   * Typesense; no application flow scans. Cursor-based so a single
   * Lambda invocation can process a bounded batch.
   */
  async scanPage(startKey: Record<string, unknown> | undefined, limit: number): Promise<ScanPage> {
    const response = await getDdbClient().send(
      new ScanCommand({
        TableName: tableName(),
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    // Parse each row through Zod at the DDB boundary. Any malformed row
    // is dropped + logged rather than thrown so a single corrupt entry
    // doesn't poison a whole backfill batch.
    const raw = response.Items ?? [];
    const items: Building[] = [];
    for (const row of raw) {
      const parsed = Building.safeParse(row);
      if (parsed.success) {
        items.push(parsed.data);
      } else {
        logger.warn("⚠️ Skipping malformed Buildings row during scan", {
          buildingId: typeof row?.buildingId === "string" ? row.buildingId : undefined,
          issues: parsed.error.issues,
        });
      }
    }
    return { items, lastKey: response.LastEvaluatedKey };
  }
}

export const buildingsRepository = new BuildingsRepository();
