import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "../ddb/client";

export interface RateLimitResult {
  current: number;
  limit: number;
  reset: number;
}

function tableName(): string {
  const name = process.env.RATE_LIMITS_TABLE_NAME;
  if (!name) {
    // Fallback or throw? The conventions say it's a shared table.
    // If it's missing, we might want to fail open in dev but closed in prod.
    // For now, let's throw to ensure it's configured.
    throw new Error("RATE_LIMITS_TABLE_NAME env var not set");
  }
  return name;
}

/**
 * RateLimitsRepository — handles atomic increments for rate limiting.
 *
 * Uses a fixed-window approach: the key includes a timestamp bucket.
 * Items auto-expire via DynamoDB TTL.
 */
export async function incrementAndGet(params: {
  service: string;
  action: string;
  identifier: string;
  windowMs: number;
  limit: number;
}): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / params.windowMs) * params.windowMs;
  const reset = windowStart + params.windowMs;
  const expiresAt = Math.floor(reset / 1000) + 3600; // TTL: 1 hour after window ends

  const key = `RL#${params.service}#${params.action}#${params.identifier}#${windowStart}`;

  const res = await getDdbClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { key },
      UpdateExpression: "SET expiresAt = :exp ADD #count :one",
      ExpressionAttributeNames: {
        "#count": "count",
      },
      ExpressionAttributeValues: {
        ":exp": expiresAt,
        ":one": 1,
      },
      ReturnValues: "UPDATED_NEW",
    }),
  );

  const current = (res.Attributes?.count as number) ?? 1;

  return {
    current,
    limit: params.limit,
    reset: Math.floor(reset / 1000),
  };
}
