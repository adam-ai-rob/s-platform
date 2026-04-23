import { describe, expect, test } from "bun:test";

/**
 * Scaffold smoke test — keeps `bun test tests/*.test.ts` exiting 0
 * until the entity + service tests land in #66.
 *
 * Verifies the `createApi()` metadata is wired (title + version) and
 * that the app exposes `getOpenAPIDocument` so contracts:build can
 * harvest it. /health, /info, /openapi.json, /docs are mounted via
 * plain `app.get()` in the factory and do NOT appear in the spec —
 * they're platform endpoints, not the module's business API.
 */
describe("s-building scaffold", () => {
  test("api.ts default export is a runnable Hono app with OpenAPI harvest support", async () => {
    process.env.BUILDINGS_TABLE_NAME ??= "Buildings-scaffold-test";
    const { default: app } = await import("../functions/src/api");

    expect(typeof app.getOpenAPIDocument).toBe("function");
    const doc = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "scaffold-test", version: "0" },
    }) as { openapi: string; info: { title: string }; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    // Scaffold has no business routes yet; #66/#69/#70 fill the paths map.
    expect(doc.paths).toBeDefined();
    expect(doc.info.title).toBe("scaffold-test");
  });
});
