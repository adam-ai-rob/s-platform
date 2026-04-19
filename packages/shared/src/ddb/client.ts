import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Singleton DynamoDB Document client.
 *
 * Reused across Lambda invocations in the same container (warm starts).
 * Cold starts create a new client.
 *
 * Marshaller settings:
 *   - removeUndefinedValues: true  — `undefined` fields are skipped
 *   - convertClassInstanceToMap: false — don't try to marshal class instances
 */

let client: DynamoDBDocumentClient | null = null;

export function getDdbClient(): DynamoDBDocumentClient {
  if (!client) {
    const endpoint = process.env.DDB_ENDPOINT;
    const ddb = new DynamoDBClient({
      region: process.env.AWS_REGION ?? "eu-west-1",
      ...(endpoint
        ? {
            endpoint,
            credentials: { accessKeyId: "local", secretAccessKey: "local" },
          }
        : {}),
    });
    client = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }
  return client;
}

/**
 * Reset the cached DynamoDB client. Intended for tests that reconfigure
 * `DDB_ENDPOINT` between suites. Never call from production code.
 */
export function __resetDdbClientForTests(): void {
  client = null;
}

/**
 * Check if an error is a DynamoDB ConditionalCheckFailedException.
 * Use to detect idempotent insert/update conflicts.
 */
export function isConditionalCheckFailed(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "ConditionalCheckFailedException" ||
      (err as { __type?: string }).__type?.includes("ConditionalCheckFailedException") === true)
  );
}
