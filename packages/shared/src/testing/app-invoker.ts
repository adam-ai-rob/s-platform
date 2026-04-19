import type { Hono } from "hono";

/**
 * Thin wrapper around Hono's built-in `app.request(...)` dispatcher.
 * Serializes a JSON body (if provided), adds an Authorization header
 * from `options.token`, and returns a structured response with the
 * parsed body.
 */
export interface InvokeOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface InvokeResult<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  raw: Response;
}

export async function invoke<T = unknown>(
  app: Hono<never, never, "/">,
  path: string,
  options: InvokeOptions = {},
): Promise<InvokeResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
    init.headers = headers;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Hono generic type is narrow
  const res: Response = await (app as any).request(path, init);
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await res.json()) as T)
    : ((await res.text()) as unknown as T);

  return { status: res.status, headers: res.headers, body, raw: res };
}
