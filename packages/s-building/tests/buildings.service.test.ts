import { beforeEach, describe, expect, test } from "bun:test";

/**
 * Service-layer tests — the repository is stubbed with an in-memory
 * Map keyed by buildingId. Exercises status transitions, validation
 * errors, and the happy path for every CRUD method.
 */

process.env.BUILDINGS_TABLE_NAME ??= "Buildings-unit-test";

type Building = import("../core/src/buildings/buildings.entity").Building;

const repoModule = await import("../core/src/buildings/buildings.repository");
const service = await import("../core/src/buildings/buildings.service");
const errors = await import("../core/src/buildings/buildings.errors");

const original = {
  findById: repoModule.buildingsRepository.findById.bind(repoModule.buildingsRepository),
  insert: repoModule.buildingsRepository.insert.bind(repoModule.buildingsRepository),
  update: repoModule.buildingsRepository.update.bind(repoModule.buildingsRepository),
  deleteById: repoModule.buildingsRepository.deleteById.bind(repoModule.buildingsRepository),
};

const store = new Map<string, Building>();

function stubRepo(): void {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).findById = async (id: string) => store.get(id);
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).insert = async (b: Building) => {
    if (store.has(b.buildingId)) {
      const err = new Error("ConditionalCheckFailedException");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    store.set(b.buildingId, b);
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).update = async (id: string, patch: Partial<Building>) => {
    const existing = store.get(id);
    if (!existing) return;
    store.set(id, { ...existing, ...patch } as Building);
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).deleteById = async (id: string) => {
    store.delete(id);
  };
}

function restoreRepo(): void {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).findById = original.findById;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).insert = original.insert;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).update = original.update;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (repoModule.buildingsRepository as any).deleteById = original.deleteById;
}

const VALID_INPUT = {
  name: "Karlín Tower",
  address: {
    formatted: "Karlínské nám. 5, 186 00 Praha 8, Czech Republic",
    streetAddress: "Karlínské nám. 5",
    locality: "Praha",
    postalCode: "186 00",
    countryCode: "CZ",
  },
  areaSqm: 4200,
  population: 350,
  primaryLanguage: "cs",
  supportedLanguages: ["cs", "en"],
  currency: "CZK",
  timezone: "Europe/Prague",
};

beforeEach(() => {
  store.clear();
  stubRepo();
});

describe("createBuilding", () => {
  test("creates a draft by default", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    expect(b.status).toBe("draft");
    expect(b.buildingId).toBeDefined();
    expect(b.createdAt).toBe(b.updatedAt);
    expect(b.createdAtMs).toBe(b.updatedAtMs);
    expect(store.has(b.buildingId)).toBe(true);
    restoreRepo();
  });

  test("respects explicit status", async () => {
    const b = await service.createBuilding({ ...VALID_INPUT, status: "active" });
    expect(b.status).toBe("active");
    restoreRepo();
  });

  test("rejects invalid input with BuildingValidationError", async () => {
    await expect(service.createBuilding({ ...VALID_INPUT, name: "" })).rejects.toBeInstanceOf(
      errors.BuildingValidationError,
    );
    restoreRepo();
  });

  test("rejects supportedLanguages missing primaryLanguage", async () => {
    await expect(
      service.createBuilding({
        ...VALID_INPUT,
        primaryLanguage: "fr",
        supportedLanguages: ["cs", "en"],
      }),
    ).rejects.toBeInstanceOf(errors.BuildingValidationError);
    restoreRepo();
  });
});

describe("getBuilding", () => {
  test("returns existing", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    const found = await service.getBuilding(b.buildingId);
    expect(found.buildingId).toBe(b.buildingId);
    restoreRepo();
  });

  test("throws BuildingNotFoundError when absent", async () => {
    await expect(service.getBuilding("nonexistent")).rejects.toBeInstanceOf(
      errors.BuildingNotFoundError,
    );
    restoreRepo();
  });
});

describe("updateBuilding", () => {
  test("updates name + bumps timestamps", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    const originalUpdatedAtMs = b.updatedAtMs;
    // Sleep 2ms to guarantee a different epoch.
    await new Promise((r) => setTimeout(r, 2));
    const updated = await service.updateBuilding(b.buildingId, { name: "Karlín Tower II" });
    expect(updated.name).toBe("Karlín Tower II");
    expect(updated.updatedAtMs).toBeGreaterThan(originalUpdatedAtMs);
    expect(updated.createdAtMs).toBe(b.createdAtMs);
    restoreRepo();
  });

  test("rejects breaking the supportedLanguages invariant via PATCH", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    await expect(
      service.updateBuilding(b.buildingId, { supportedLanguages: ["en"] }),
    ).rejects.toBeInstanceOf(errors.BuildingValidationError);
    restoreRepo();
  });

  test("allows swapping primary + supported together", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    const updated = await service.updateBuilding(b.buildingId, {
      primaryLanguage: "en",
      supportedLanguages: ["en", "de"],
    });
    expect(updated.primaryLanguage).toBe("en");
    expect(updated.supportedLanguages).toEqual(["en", "de"]);
    restoreRepo();
  });

  test("404s when missing", async () => {
    await expect(service.updateBuilding("nonexistent", { name: "x" })).rejects.toBeInstanceOf(
      errors.BuildingNotFoundError,
    );
    restoreRepo();
  });
});

describe("status transitions", () => {
  test("draft → active via activateBuilding", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    const activated = await service.activateBuilding(b.buildingId);
    expect(activated.status).toBe("active");
    restoreRepo();
  });

  test("active → archived via archiveBuilding", async () => {
    const b = await service.createBuilding({ ...VALID_INPUT, status: "active" });
    const archived = await service.archiveBuilding(b.buildingId);
    expect(archived.status).toBe("archived");
    restoreRepo();
  });

  test("archived → active is allowed (re-activation)", async () => {
    const b = await service.createBuilding({ ...VALID_INPUT, status: "active" });
    await service.archiveBuilding(b.buildingId);
    const reactivated = await service.activateBuilding(b.buildingId);
    expect(reactivated.status).toBe("active");
    restoreRepo();
  });

  test("archived → draft is illegal", async () => {
    // Seed `archived` manually because service rejects direct draft→archived.
    const b = await service.createBuilding({ ...VALID_INPUT, status: "active" });
    await service.archiveBuilding(b.buildingId);
    // Now attempt a disallowed transition by calling the private helper
    // via its public entrypoint. `activateBuilding` is the only way back
    // to active; there's no public way to go archived → draft, which is
    // what we want. Verify there's no slipped-through path via update:
    await expect(
      service.updateBuilding(b.buildingId, {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid
        status: "draft" as any,
      }),
    ).resolves.toBeDefined();
    // The patch silently drops `status` (not in UpdateBuildingInput), so
    // the row remains archived — this is the safe behaviour.
    const after = await service.getBuilding(b.buildingId);
    expect(after.status).toBe("archived");
    restoreRepo();
  });

  test("activateBuilding on already-active is a no-op", async () => {
    const b = await service.createBuilding({ ...VALID_INPUT, status: "active" });
    const result = await service.activateBuilding(b.buildingId);
    expect(result.status).toBe("active");
    expect(result.updatedAtMs).toBe(b.updatedAtMs); // no rewrite
    restoreRepo();
  });

  test("activateBuilding throws BuildingStatusConflictError from archived only when illegal", async () => {
    // archived → active is allowed (test above). The illegal one is
    // active → draft or draft → archived — verify the latter.
    const b = await service.createBuilding(VALID_INPUT);
    await expect(service.archiveBuilding(b.buildingId)).rejects.toBeInstanceOf(
      errors.BuildingStatusConflictError,
    );
    restoreRepo();
  });
});

describe("deleteBuilding", () => {
  test("deletes an existing building", async () => {
    const b = await service.createBuilding(VALID_INPUT);
    await service.deleteBuilding(b.buildingId);
    await expect(service.getBuilding(b.buildingId)).rejects.toBeInstanceOf(
      errors.BuildingNotFoundError,
    );
    restoreRepo();
  });

  test("404s when missing", async () => {
    await expect(service.deleteBuilding("nonexistent")).rejects.toBeInstanceOf(
      errors.BuildingNotFoundError,
    );
    restoreRepo();
  });
});
