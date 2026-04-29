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

  test("loads pinned Swagger UI assets with integrity checks", () => {
    const html = renderConsolePage();

    expect(html).toContain("swagger-ui-dist@5.17.14/swagger-ui.css");
    expect(html).toContain("swagger-ui-dist@5.17.14/swagger-ui-bundle.js");
    expect(html).toContain("swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js");
    expect(html).toContain(
      'integrity="sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn"',
    );
    expect(html).toContain(
      'integrity="sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep"',
    );
    expect(html).toContain(
      'integrity="sha384-2YH8WDRaj7V2OqU/trsmzSagmk/E2SutiCsGkdgoQwC9pNUJV1u/141DHB6jgs8t"',
    );
    expect(html).toContain("SwaggerUIStandalonePreset");
    expect(html).toContain('layout: "StandaloneLayout"');
  });

  test("derives the primary OpenAPI spec from the registry", () => {
    const html = renderConsolePage();

    expect(html).toContain("const primaryModule = modules[0]");
    expect(html).not.toContain('"urls.primaryName": "authn - Authentication"');
  });

  test("serves the console as hardened uncached HTML", async () => {
    const response = await handler({ requestContext: { http: { method: "GET" } } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=UTF-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["referrer-policy"]).toBe("same-origin");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.body).toContain("s-platform console");
  });

  test("rejects unsupported methods", async () => {
    const response = await handler({ requestContext: { http: { method: "POST" } } });

    expect(response.statusCode).toBe(405);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
  });
});
