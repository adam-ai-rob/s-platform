import {
  CreateTableCommand,
  type CreateTableCommandInput,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

/**
 * Minimal declarative table schema. Only covers what the test harness
 * needs — partition key, optional sort key, optional GSIs. Everything is
 * PAY_PER_REQUEST and streams-off; tests don't exercise streams.
 */
export interface TableSchema {
  tableName: string;
  partitionKey: string;
  sortKey?: string;
  /** Attributes referenced by GSIs but not the main key. */
  attributeTypes?: Record<string, "S" | "N" | "B">;
  indexes?: {
    indexName: string;
    partitionKey: string;
    sortKey?: string;
  }[];
}

function rawClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

export async function createTable(endpoint: string, schema: TableSchema): Promise<void> {
  const client = rawClient(endpoint);

  const attributeDefs = new Map<string, "S" | "N" | "B">();
  attributeDefs.set(schema.partitionKey, schema.attributeTypes?.[schema.partitionKey] ?? "S");
  if (schema.sortKey) {
    attributeDefs.set(schema.sortKey, schema.attributeTypes?.[schema.sortKey] ?? "S");
  }
  for (const gsi of schema.indexes ?? []) {
    attributeDefs.set(gsi.partitionKey, schema.attributeTypes?.[gsi.partitionKey] ?? "S");
    if (gsi.sortKey) {
      attributeDefs.set(gsi.sortKey, schema.attributeTypes?.[gsi.sortKey] ?? "S");
    }
  }

  const input: CreateTableCommandInput = {
    TableName: schema.tableName,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [...attributeDefs.entries()].map(([name, type]) => ({
      AttributeName: name,
      AttributeType: type,
    })),
    KeySchema: [
      { AttributeName: schema.partitionKey, KeyType: "HASH" },
      ...(schema.sortKey ? [{ AttributeName: schema.sortKey, KeyType: "RANGE" as const }] : []),
    ],
    ...(schema.indexes && schema.indexes.length > 0
      ? {
          GlobalSecondaryIndexes: schema.indexes.map((gsi) => ({
            IndexName: gsi.indexName,
            KeySchema: [
              { AttributeName: gsi.partitionKey, KeyType: "HASH" as const },
              ...(gsi.sortKey ? [{ AttributeName: gsi.sortKey, KeyType: "RANGE" as const }] : []),
            ],
            Projection: { ProjectionType: "ALL" },
          })),
        }
      : {}),
  };

  await client.send(new CreateTableCommand(input));
  await waitUntilTableExists({ client, maxWaitTime: 10 }, { TableName: schema.tableName });
  client.destroy();
}

export async function deleteTableIfExists(endpoint: string, tableName: string): Promise<void> {
  const client = rawClient(endpoint);
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  } finally {
    client.destroy();
  }
}
