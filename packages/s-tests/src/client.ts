import { getStageConfig } from "./config";

/**
 * Typed HTTP client for the deployed platform.
 *
 * Phase 1 (this file): a thin fetch wrapper that injects the stage base
 * URL and bearer token. Endpoint-specific typed methods are added per
 * module as modules land (e.g., `client.authn.register(body)`).
 *
 * Phase 2: generate strongly-typed methods from each module's
 * `/openapi.json` at test-runtime via `openapi-fetch` or similar, so
 * request/response types track the deployed contract automatically.
 */

export interface TestClient {
  baseUrl: string;
  request<T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T>;
  setToken(token: string | undefined): void;
  getToken(): string | undefined;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

export function createTestClient(): TestClient {
  const { apiUrl } = getStageConfig();
  let token: string | undefined;

  return {
    baseUrl: apiUrl,

    setToken(t) {
      token = t;
    },

    getToken() {
      return token;
    },

    async request<T = unknown>(
      method: string,
      path: string,
      options: RequestOptions = {},
    ): Promise<T> {
      const url = new URL(path.startsWith("/") ? path : `/${path}`, apiUrl);

      if (options.query) {
        for (const [k, v] of Object.entries(options.query)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : null;

      if (!res.ok) {
        throw new TestHttpError(res.status, res.statusText, json);
      }
      return json as T;
    },
  };
}

export class TestHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status} ${statusText}: ${JSON.stringify(body)}`);
    this.name = "TestHttpError";
  }
}
