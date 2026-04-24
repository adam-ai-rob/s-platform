import { describe, expect, test } from "bun:test";
import type { UserContext } from "@s/shared/types";
import type { Context } from "hono";
import {
  buildingAccess,
  callerScopedBuildingIds,
  hasSuperadmin,
} from "../functions/src/routes/_access";
import type { AppEnv } from "../functions/src/types";

function user(permissions: UserContext["permissions"], system?: boolean): UserContext {
  return {
    userId: "01HXYUSER000000000000000000",
    permissions,
    ...(system ? { system } : {}),
  };
}

function ctx(caller: UserContext): Context<AppEnv> {
  return {
    get(key: string) {
      if (key === "user") return caller;
      return undefined;
    },
  } as unknown as Context<AppEnv>;
}

describe("s-building access wrappers", () => {
  test("hasSuperadmin checks the building superadmin permission", () => {
    expect(hasSuperadmin(user([{ id: "building_superadmin" }]))).toBe(true);
    expect(hasSuperadmin(user([{ id: "building_admin", value: ["b1"] }]))).toBe(false);
  });

  test("callerScopedBuildingIds delegates to shared scope collection", () => {
    const ids = callerScopedBuildingIds(
      user([
        { id: "building_admin", value: ["b1", "b2"] },
        { id: "building_manager", value: ["b2", "b3"] },
      ]),
      ["building_admin", "building_manager"],
    );

    expect([...ids].sort()).toEqual(["b1", "b2", "b3"]);
  });

  test("buildingAccess applies building superadmin and scoped permission rules", () => {
    expect(
      buildingAccess(ctx(user([{ id: "building_superadmin" }])), "anything", ["building_admin"]),
    ).toBe(true);
    expect(
      buildingAccess(ctx(user([{ id: "building_admin", value: ["b1"] }])), "b1", [
        "building_admin",
      ]),
    ).toBe(true);
    expect(
      buildingAccess(ctx(user([{ id: "building_admin", value: ["b1"] }])), "b2", [
        "building_admin",
      ]),
    ).toBe(false);
  });
});
