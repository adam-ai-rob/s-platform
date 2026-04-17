import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "./client";
import { decodeNextToken, encodeNextToken, type PaginatedResult } from "./pagination";

/**
 * BaseRepository — generic CRUD + GSI queries for a single DynamoDB table.
 *
 * Modules extend this with domain-specific methods:
 *
 *   class UsersRepository extends BaseRepository<User, { id: string }> {
 *     constructor() {
 *       super({ tableName: Resource.AuthnUsers.name, keyFields: { partitionKey: "id" } });
 *     }
 *
 *     async findByEmail(email: string): Promise<User | undefined> {
 *       const { items } = await this.queryByIndex("ByEmail", "email", email, { limit: 1 });
 *       return items[0];
 *     }
 *   }
 *
 * Rules:
 * - One repository per table
 * - Repositories NEVER contain business logic (except transactions for atomicity)
 * - No direct DynamoDBClient usage outside this file + derived repos
 */

export interface BaseRepositoryOptions {
  tableName: string;
  keyFields: {
    partitionKey: string;
    sortKey?: string;
  };
}

export interface QueryOptions {
  limit?: number;
  nextToken?: string;
  scanIndexForward?: boolean;
  sortKey?: string;
  sortValue?: string;
  sortComparator?: "=" | "<" | ">" | "<=" | ">=" | "begins_with" | "between";
  sortValueEnd?: string; // for between
}

export abstract class BaseRepository<TEntity, TKeys extends Record<string, string>> {
  protected readonly tableName: string;
  protected readonly partitionKey: string;
  protected readonly sortKey?: string;

  constructor(options: BaseRepositoryOptions) {
    this.tableName = options.tableName;
    this.partitionKey = options.keyFields.partitionKey;
    this.sortKey = options.keyFields.sortKey;
  }

  /**
   * Get one item by its primary key.
   * Returns `undefined` if not found.
   */
  async get(partitionKey: string, sortKey?: string): Promise<TEntity | undefined> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey !== undefined) {
      key[this.sortKey] = sortKey;
    }

    const res = await getDdbClient().send(
      new GetCommand({
        TableName: this.tableName,
        Key: key,
      }),
    );

    return res.Item as TEntity | undefined;
  }

  /**
   * Put (create or replace) an item.
   * Optionally pass a condition expression for idempotent inserts:
   *   repo.put(item, { condition: "attribute_not_exists(id)" })
   */
  async put(
    item: TEntity,
    options: { condition?: string; conditionValues?: Record<string, unknown> } = {},
  ): Promise<void> {
    await getDdbClient().send(
      new PutCommand({
        TableName: this.tableName,
        Item: item as Record<string, unknown>,
        ConditionExpression: options.condition,
        ExpressionAttributeValues: options.conditionValues,
      }),
    );
  }

  /**
   * Partial update. `null`, `undefined`, `""`, or `[]` in updates map to
   * DynamoDB REMOVE; other values map to SET.
   *
   * This is the PATCH semantics referenced in API conventions:
   * clients can submit null/"" to drop a field without reading first.
   */
  async patch(
    partitionKey: string,
    sortKey: string | undefined,
    updates: Partial<TEntity>,
  ): Promise<void> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey !== undefined) {
      key[this.sortKey] = sortKey;
    }

    const { expression, names, values } = buildUpdateExpression(updates);
    if (!expression) return; // nothing to update

    await getDdbClient().send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
      }),
    );
  }

  /**
   * Delete an item. Idempotent (no error if not found).
   */
  async delete(partitionKey: string, sortKey?: string): Promise<void> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey !== undefined) {
      key[this.sortKey] = sortKey;
    }

    await getDdbClient().send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: key,
      }),
    );
  }

  /**
   * Query a GSI by its partition key (and optional sort key condition).
   *
   *   queryByIndex("ByEmail", "email", "alice@example.com", { limit: 10 })
   *   queryByIndex("ByUserId", "userId", "01HXYZ", {
   *     sortKey: "createdAt", sortValue: "2026-", sortComparator: "begins_with"
   *   })
   */
  async queryByIndex(
    indexName: string,
    partitionKeyName: string,
    partitionKeyValue: string,
    options: QueryOptions = {},
  ): Promise<PaginatedResult<TEntity>> {
    const names: Record<string, string> = { "#pk": partitionKeyName };
    const values: Record<string, unknown> = { ":pkv": partitionKeyValue };

    let keyCondition = "#pk = :pkv";

    if (options.sortKey && options.sortValue !== undefined) {
      names["#sk"] = options.sortKey;
      values[":skv"] = options.sortValue;

      const cmp = options.sortComparator ?? "=";
      if (cmp === "begins_with") {
        keyCondition += " AND begins_with(#sk, :skv)";
      } else if (cmp === "between" && options.sortValueEnd !== undefined) {
        values[":skv2"] = options.sortValueEnd;
        keyCondition += " AND #sk BETWEEN :skv AND :skv2";
      } else {
        keyCondition += ` AND #sk ${cmp} :skv`;
      }
    }

    const res = await getDdbClient().send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: options.limit ?? 20,
        ExclusiveStartKey: decodeNextToken(options.nextToken),
        ScanIndexForward: options.scanIndexForward,
      }),
    );

    return {
      items: (res.Items ?? []) as TEntity[],
      nextToken: encodeNextToken(res.LastEvaluatedKey),
    };
  }

  /**
   * Query the main table by its partition key.
   */
  async queryByPartitionKey(
    partitionKeyValue: string,
    options: QueryOptions = {},
  ): Promise<PaginatedResult<TEntity>> {
    return this.queryByIndex("", this.partitionKey, partitionKeyValue, options);
  }
}

/**
 * Build a DynamoDB UpdateExpression from a partial entity.
 *
 * null, undefined, "", and [] → REMOVE
 * Everything else → SET
 */
function buildUpdateExpression(updates: Record<string, unknown>): {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const sets: string[] = [];
  const removes: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    const attrName = `#${sanitize(key)}`;
    names[attrName] = key;

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      removes.push(attrName);
    } else {
      const attrValue = `:${sanitize(key)}`;
      values[attrValue] = value;
      sets.push(`${attrName} = ${attrValue}`);
    }
  }

  const parts: string[] = [];
  if (sets.length > 0) parts.push(`SET ${sets.join(", ")}`);
  if (removes.length > 0) parts.push(`REMOVE ${removes.join(", ")}`);

  return {
    expression: parts.join(" "),
    names,
    values,
  };
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "_");
}
