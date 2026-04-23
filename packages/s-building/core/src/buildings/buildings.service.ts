import { type PaginatedResult, isConditionalCheckFailed } from "@s/shared/ddb";
import { ConflictError } from "@s/shared/errors";
import { logger } from "@s/shared/logger";
import { ulid } from "ulid";
import {
  type Building,
  type BuildingStatus,
  CreateBuildingInput,
  UpdateBuildingInput,
} from "./buildings.entity";
import {
  BuildingNotFoundError,
  BuildingStatusConflictError,
  BuildingValidationError,
} from "./buildings.errors";
import { buildingsRepository } from "./buildings.repository";

/**
 * Building service — permission-agnostic CRUD + lifecycle transitions.
 *
 * The route layer is responsible for scoped-permission enforcement
 * (controller-layer filtering per the plan in #62). The service trusts
 * its inputs and focuses on business invariants:
 *   - Entity shape (Zod-validated on every mutation path)
 *   - Status transition legality
 *   - Idempotent timestamps
 *
 * Persistence is behind `buildingsRepository`; no direct DDB here.
 *
 * Typesense indexing happens via the stream-handler → indexer path
 * (#67, #68), not inline — keeps the sync write path fast and the
 * index eventually-consistent-but-authoritative.
 */

const ALLOWED_TRANSITIONS: Record<BuildingStatus, readonly BuildingStatus[]> = {
  draft: ["active"],
  active: ["archived"],
  archived: ["active"],
} as const;

/**
 * Throws `BuildingStatusConflictError` when `from → to` is not in
 * `ALLOWED_TRANSITIONS`. Does NOT short-circuit same-status calls —
 * callers check `from === to` first so idempotency is explicit at the
 * call site and this function remains the single authoritative source
 * of transition legality.
 */
function assertTransition(from: BuildingStatus, to: BuildingStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BuildingStatusConflictError(from, to);
  }
}

function now(): { iso: string; ms: number } {
  const date = new Date();
  return { iso: date.toISOString(), ms: date.getTime() };
}

export async function createBuilding(input: unknown): Promise<Building> {
  const parsed = CreateBuildingInput.safeParse(input);
  if (!parsed.success) {
    throw new BuildingValidationError("Invalid building input", {
      issues: parsed.error.issues,
    });
  }
  const { iso, ms } = now();
  const building: Building = {
    buildingId: ulid(),
    name: parsed.data.name,
    description: parsed.data.description,
    address: parsed.data.address,
    areaSqm: parsed.data.areaSqm,
    population: parsed.data.population,
    primaryLanguage: parsed.data.primaryLanguage,
    supportedLanguages: parsed.data.supportedLanguages,
    currency: parsed.data.currency,
    timezone: parsed.data.timezone,
    status: parsed.data.status ?? "draft",
    createdAt: iso,
    updatedAt: iso,
    createdAtMs: ms,
    updatedAtMs: ms,
  };

  try {
    await buildingsRepository.insert(building);
  } catch (err) {
    // Extremely unlikely — ULID collision — but we'd rather surface a
    // 409 than silently return a half-written row.
    if (isConditionalCheckFailed(err)) {
      throw new ConflictError(`Building ${building.buildingId} already exists`);
    }
    throw err;
  }

  logger.info("🏢 Building created", {
    buildingId: building.buildingId,
    status: building.status,
  });
  return building;
}

export async function getBuilding(buildingId: string): Promise<Building> {
  const b = await buildingsRepository.findById(buildingId);
  if (!b) throw new BuildingNotFoundError(buildingId);
  return b;
}

export async function updateBuilding(buildingId: string, patch: unknown): Promise<Building> {
  const existing = await buildingsRepository.findById(buildingId);
  if (!existing) throw new BuildingNotFoundError(buildingId);

  const parsed = UpdateBuildingInput.safeParse(patch);
  if (!parsed.success) {
    throw new BuildingValidationError("Invalid building patch", {
      issues: parsed.error.issues,
    });
  }

  // supportedLanguages + primaryLanguage invariant must hold post-merge
  // too — validate the merged shape. Zod on the input alone can't catch
  // it because the fields are independently optional.
  const merged = {
    primaryLanguage: parsed.data.primaryLanguage ?? existing.primaryLanguage,
    supportedLanguages: parsed.data.supportedLanguages ?? existing.supportedLanguages,
  };
  if (!merged.supportedLanguages.includes(merged.primaryLanguage)) {
    throw new BuildingValidationError(
      `supportedLanguages must include primaryLanguage (${merged.primaryLanguage})`,
      { primaryLanguage: merged.primaryLanguage, supportedLanguages: merged.supportedLanguages },
    );
  }

  const { iso, ms } = now();
  await buildingsRepository.update(buildingId, {
    ...parsed.data,
    updatedAt: iso,
    updatedAtMs: ms,
  });
  logger.info("🏢 Building updated", { buildingId });
  return getBuilding(buildingId);
}

export async function archiveBuilding(buildingId: string): Promise<Building> {
  return transitionStatus(buildingId, "archived");
}

export async function activateBuilding(buildingId: string): Promise<Building> {
  return transitionStatus(buildingId, "active");
}

async function transitionStatus(buildingId: string, next: BuildingStatus): Promise<Building> {
  const existing = await buildingsRepository.findById(buildingId);
  if (!existing) throw new BuildingNotFoundError(buildingId);
  // Idempotent no-op: same-status calls return the existing row without
  // rewriting timestamps. Must run before `assertTransition` because
  // `from === to` is not in `ALLOWED_TRANSITIONS[from]` for any status.
  if (existing.status === next) return existing;
  assertTransition(existing.status, next);

  const { iso, ms } = now();
  await buildingsRepository.update(buildingId, {
    status: next,
    updatedAt: iso,
    updatedAtMs: ms,
  });
  logger.info("🏢 Building status changed", {
    buildingId,
    from: existing.status,
    to: next,
  });
  return getBuilding(buildingId);
}

export async function deleteBuilding(buildingId: string): Promise<void> {
  const existing = await buildingsRepository.findById(buildingId);
  if (!existing) throw new BuildingNotFoundError(buildingId);
  await buildingsRepository.deleteById(buildingId);
  logger.info("🏢 Building deleted", { buildingId });
}

export async function listBuildingsByStatus(
  status: BuildingStatus,
  options: { limit?: number; nextToken?: string } = {},
): Promise<PaginatedResult<Building>> {
  return buildingsRepository.listByStatus(status, options);
}
