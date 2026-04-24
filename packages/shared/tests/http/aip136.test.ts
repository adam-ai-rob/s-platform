import { describe, expect, test } from "bun:test";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { enableAip136Actions } from "../../src/http/aip136";

function createTestApp(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: "post",
      path: "/foo/{id}/_actions/bar",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ id: z.string() }),
            },
          },
          description: "Ok",
        },
      },
    }),
    (c) => c.json({ id: c.req.param("id") }, 200),
  );

  enableAip136Actions(app);
  return app;
}

describe("enableAip136Actions", () => {
  test("fetch rewrites public :verb URLs to the internal action route", async () => {
    const app = createTestApp();
    const res = await app.fetch(new Request("http://localhost/foo/abc:bar", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc" });
  });

  test("direct fetch ingress to /_actions is blocked", async () => {
    const app = createTestApp();
    const res = await app.fetch(
      new Request("http://localhost/foo/abc/_actions/bar", { method: "POST" }),
    );

    expect(res.status).toBe(404);
  });

  test("OpenAPI emits the public :verb path", () => {
    const app = createTestApp();
    const doc = app.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "test", version: "1.0.0" },
    });

    expect(doc.paths["/foo/{id}:bar"]).toBeDefined();
    expect(doc.paths["/foo/{id}/_actions/bar"]).toBeUndefined();
  });

  test("app.request uses the same rewrite as fetch", async () => {
    const app = createTestApp();
    const res = await app.request("/foo/abc:bar", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc" });
  });

  test("direct app.request ingress to /_actions is blocked", async () => {
    const app = createTestApp();
    const res = await app.request("/foo/abc/_actions/bar", { method: "POST" });

    expect(res.status).toBe(404);
  });
});
