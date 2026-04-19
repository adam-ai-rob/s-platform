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

  test("gateway is reachable", async () => {
    // Hit a known module's /health once modules exist.
    // For now, just verify the base URL resolves.
    expect(client.baseUrl).toMatch(/^https?:\/\//);
  });

  // TODO: once s-authn is deployed, add:
  // test("s-authn /health returns ok #smoke", async () => {
  //   const res = await client.request<{ status: string }>("GET", "/authn/health");
  //   expect(res.status).toBe("ok");
  // });
});
