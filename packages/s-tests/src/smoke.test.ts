import { describe, expect, test } from "bun:test";
import "./setup";
import { createTestClient } from "./client";

/**
 * Platform-level smoke tests.
 *
 * These run against any stage and verify the gateway is up. Module-specific
 * journey tests live in `src/journeys/`.
 *
 * Filter tag: `#smoke` — runs in the prod deploy post-check.
 */

describe("platform smoke", () => {
  const client = createTestClient();
  const deployedSmoke = process.env.RUN_DEPLOYED_SMOKE === "1";
  const deployedSmokeTest = deployedSmoke ? test : test.skip;

  test("gateway is reachable", async () => {
    // Hit a known module's /health once modules exist.
    // For now, just verify the base URL resolves.
    expect(client.baseUrl).toMatch(/^https?:\/\//);
  });

  deployedSmokeTest("platform console loads #smoke", async () => {
    const response = await fetch(new URL("/platform/status", client.baseUrl));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("s-platform console");
    expect(body).toContain('"id":"authn"');
    expect(body).toContain('"id":"building"');
    expect(body).toContain('module.basePath + "/health"');
    expect(body).toContain('module.basePath + "/openapi.json"');
    expect(body).toContain('module.basePath + "/info"');
  });

  deployedSmokeTest("module info endpoints require bearer token #smoke", async () => {
    const response = await fetch(new URL("/authn/info", client.baseUrl));

    expect(response.status).toBe(401);
  });

  deployedSmokeTest("module health endpoints return ok #smoke", async () => {
    const modules = ["authn", "authz", "user", "group", "building"];

    await Promise.all(
      modules.map(async (module) => {
        const res = await client.request<{ status: string }>("GET", `/${module}/health`);
        expect(res.status).toBe("ok");
      }),
    );
  });
});
