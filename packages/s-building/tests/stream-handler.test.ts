import { describe, expect, test } from "bun:test";
import type { Building } from "../core/src/buildings/buildings.entity";
import { diffRecord } from "../functions/src/stream-handler";

/**
 * Pure-function tests for the stream-handler's transition matrix. No
 * DDB, no EventBridge — just the logic that decides which events fire.
 *
 * The integration-level "DDB → EventBridge" wiring is proven separately
 * in `tests/integration/stream-handler.test.ts`.
 */

function buildingFixture(overrides: Partial<Building> = {}): Building {
  return {
    buildingId: "01HXYBUILDING00000000000000",
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
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "EUR",
    timezone: "Europe/Prague",
    status: "draft",
    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T08:00:00.000Z",
    createdAtMs: 1_745_136_000_000,
    updatedAtMs: 1_745_136_000_000,
    ...overrides,
  };
}

describe("stream-handler diffRecord", () => {
  test("INSERT → building.created carrying status", () => {
    const emitted = diffRecord("INSERT", buildingFixture({ status: "draft" }), undefined);
    expect(emitted).toEqual([
      {
        eventName: "building.created",
        payload: { buildingId: "01HXYBUILDING00000000000000", status: "draft" },
      },
    ]);
  });

  test("INSERT of an already-active row surfaces its status", () => {
    const emitted = diffRecord("INSERT", buildingFixture({ status: "active" }), undefined);
    expect(emitted[0]?.payload).toEqual({
      buildingId: "01HXYBUILDING00000000000000",
      status: "active",
    });
  });

  test("MODIFY without status change → only building.updated", () => {
    const old = buildingFixture({ status: "draft", name: "Old" });
    const next = buildingFixture({ status: "draft", name: "New" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated"]);
  });

  test("MODIFY draft → active emits updated + activated", () => {
    const old = buildingFixture({ status: "draft" });
    const next = buildingFixture({ status: "active" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated", "building.activated"]);
  });

  test("MODIFY archived → active emits updated + activated (re-activation)", () => {
    const old = buildingFixture({ status: "archived" });
    const next = buildingFixture({ status: "active" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated", "building.activated"]);
  });

  test("MODIFY active → archived emits updated + archived", () => {
    const old = buildingFixture({ status: "active" });
    const next = buildingFixture({ status: "archived" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated", "building.archived"]);
  });

  test("MODIFY draft → archived emits updated + archived (defensive: raw DDB write)", () => {
    // Not allowed via the service, but the handler reads raw DDB so
    // this covers the direct-write / migration edge case.
    const old = buildingFixture({ status: "draft" });
    const next = buildingFixture({ status: "archived" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated", "building.archived"]);
  });

  test("MODIFY active → active does NOT emit a transition event", () => {
    const old = buildingFixture({ status: "active", name: "Before" });
    const next = buildingFixture({ status: "active", name: "After" });
    const emitted = diffRecord("MODIFY", next, old);
    expect(emitted.map((e) => e.eventName)).toEqual(["building.updated"]);
  });

  test("REMOVE → building.deleted with id from OldImage", () => {
    const emitted = diffRecord("REMOVE", undefined, buildingFixture({ status: "archived" }));
    expect(emitted).toEqual([
      {
        eventName: "building.deleted",
        payload: { buildingId: "01HXYBUILDING00000000000000" },
      },
    ]);
  });

  test("INSERT without a NewImage emits nothing (defensive)", () => {
    expect(diffRecord("INSERT", undefined, undefined)).toEqual([]);
  });

  test("MODIFY missing either image emits nothing (defensive)", () => {
    expect(diffRecord("MODIFY", buildingFixture(), undefined)).toEqual([]);
    expect(diffRecord("MODIFY", undefined, buildingFixture())).toEqual([]);
  });

  test("REMOVE without an OldImage emits nothing (defensive)", () => {
    expect(diffRecord("REMOVE", undefined, undefined)).toEqual([]);
  });

  test("unknown event name emits nothing", () => {
    expect(diffRecord(undefined, buildingFixture(), buildingFixture())).toEqual([]);
  });
});
