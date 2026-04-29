import { describe, expect, test } from "bun:test";
import { handler } from "./console";
import { renderConsolePage } from "./console-page";
import { platformModules } from "./module-registry";

describe("platform console", () => {
  test("renders every module endpoint from the registry", () => {
    const html = renderConsolePage();

    for (const module of platformModules) {
      expect(html).toContain(module.id);
      expect(html).toContain(module.basePath);
    }

    expect(html).toContain('module.basePath + "/health"');
    expect(html).toContain('module.basePath + "/openapi.json"');
    expect(html).toContain('module.basePath + "/info"');
  });

  test("serves the console as uncached HTML", async () => {
    const response = await handler({ requestContext: { http: { method: "GET" } } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=UTF-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("s-platform console");
  });

  test("rejects unsupported methods", async () => {
    const response = await handler({ requestContext: { http: { method: "POST" } } });

    expect(response.statusCode).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
  });
});
