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

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Response> {
  const method = event.requestContext?.http?.method ?? "GET";

  if (method !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
    },
    body: renderConsolePage(),
  };
}
