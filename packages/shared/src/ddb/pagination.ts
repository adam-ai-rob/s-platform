/**
 * Opaque pagination tokens.
 *
 * DynamoDB returns `LastEvaluatedKey` (a key object) for the next page.
 * We base64url-encode it into a `nextToken` string so clients can pass
 * it in query params without needing to understand the internal structure.
 */

export function encodeNextToken(lastKey: Record<string, unknown> | undefined): string | undefined {
  if (!lastKey) return undefined;
  return Buffer.from(JSON.stringify(lastKey)).toString("base64url");
}

export function decodeNextToken(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string;
}
