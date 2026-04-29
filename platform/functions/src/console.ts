import { renderConsolePage } from "./console-page";

interface ApiGatewayV2Event {
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
}

interface ApiGatewayV2Response {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "frame-ancestors 'none'",
  ].join("; "),
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Response> {
  const method = event.requestContext?.http?.method ?? "GET";

  if (method !== "GET") {
    return {
      statusCode: 405,
      headers: {
        ...securityHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...securityHeaders,
      "content-type": "text/html; charset=UTF-8",
    },
    body: renderConsolePage(),
  };
}
