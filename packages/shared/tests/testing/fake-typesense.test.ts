import { describe, expect, test } from "bun:test";
import { createFakeTypesenseClient } from "../../src/testing";

describe("createFakeTypesenseClient", () => {
  test("supports id-list and string equality filters", async () => {
    const fake = createFakeTypesenseClient({
      collections: {
        buildings: [
          { id: "a", name: "Alpha", status: "active" },
          { id: "b", name: "Beta", status: "draft" },
          { id: "c", name: "Gamma", status: "active" },
        ],
      },
    });

    const res = await fake.client.collections("buildings").documents().search({
      q: "*",
      query_by: "name",
      filter_by: "id:=[`a`,`b`] && status:=active",
    });

    expect(res.found).toBe(1);
    expect(res.hits?.map((hit) => hit.document.id)).toEqual(["a"]);
  });

  test("supports numeric comparison and equality filters", async () => {
    const fake = createFakeTypesenseClient({
      collections: {
        users: [
          { id: "old", displayName: "Old User", createdAtMs: 100 },
          { id: "new", displayName: "New User", createdAtMs: 200 },
        ],
      },
    });

    const res = await fake.client.collections("users").documents().search({
      q: "*",
      query_by: "displayName",
      filter_by: "createdAtMs:>=200",
    });

    expect(res.found).toBe(1);
    expect(res.hits?.map((hit) => hit.document.id)).toEqual(["new"]);

    const equalityRes = await fake.client.collections("users").documents().search({
      q: "*",
      query_by: "displayName",
      filter_by: "createdAtMs:=200",
    });

    expect(equalityRes.found).toBe(1);
    expect(equalityRes.hits?.map((hit) => hit.document.id)).toEqual(["new"]);
  });

  test("toggles health responses", async () => {
    const fake = createFakeTypesenseClient();

    fake.setHealthy(false);

    await expect(fake.client.health.retrieve()).resolves.toEqual({ ok: false });
  });
});
