# Data Access Patterns

All modules store data in DynamoDB, accessed through a shared `BaseRepository` abstraction. This document covers table design, the repository pattern, pagination, TTL, ID strategy, and the search fallback (DynamoDB vs Algolia).

## DynamoDB Philosophy

DynamoDB is not a SQL database. Data is organized around **access patterns**, declared upfront:

- **Primary key** (partition key + optional sort key) for the most common lookup
- **Global Secondary Indexes (GSIs)** for alternate access patterns
- **No joins** — denormalize, or chain calls, or use events to propagate data

Each module designs its tables to serve its bounded context's access patterns.

## Table Definition

Tables are defined in `infra/s-{module}.ts`:

```typescript
// infra/s-authn.ts
export const authnUsersTable = new sst.aws.Dynamo("AuthnUsers", {
  fields: {
    id: "string",
    email: "string",
  },
  primaryIndex: { hashKey: "id" },
  globalIndexes: {
    ByEmail: { hashKey: "email" },
  },
  stream: "new-and-old-images",   // Required — feeds the stream handler
});

export const authnRefreshTokensTable = new sst.aws.Dynamo("AuthnRefreshTokens", {
  fields: {
    jtiHash: "string",
    userId: "string",
  },
  primaryIndex: { hashKey: "jtiHash" },
  globalIndexes: {
    ByUserId: { hashKey: "userId" },
  },
  ttl: "expiresAt",               // auto-delete after TTL
  stream: "new-and-old-images",
});
```

**Rules:**

- `stream: "new-and-old-images"` on **every** table — required for the event system
- `ttl: "<fieldName>"` when rows should auto-expire (refresh tokens, processed events, rate limits)
- GSIs only for access patterns you actually use — each GSI doubles write cost

## Connection: Shared DDB Client

One DDB client per Lambda container, reused across invocations:

```typescript
// packages/shared/src/ddb/client.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

let client: DynamoDBDocumentClient | null = null;

export function getDdbClient(): DynamoDBDocumentClient {
  if (!client) {
    const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
    client = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
    });
  }
  return client;
}
```

## BaseRepository

Shared base class for all repositories. Lives in `@s/shared/ddb`:

```typescript
// packages/shared/src/ddb/base-repository.ts
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "./client.js";

export interface BaseRepositoryOptions<TKeys> {
  tableName: string;
  keyFields: {
    partitionKey: keyof TKeys;
    sortKey?: keyof TKeys;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  nextToken?: string;
}

export class BaseRepository<TEntity, TKeys extends Record<string, string>> {
  protected readonly tableName: string;
  protected readonly partitionKey: string;
  protected readonly sortKey?: string;

  constructor(options: BaseRepositoryOptions<TKeys>) {
    this.tableName = options.tableName;
    this.partitionKey = options.keyFields.partitionKey as string;
    this.sortKey = options.keyFields.sortKey as string | undefined;
  }

  async get(partitionKey: string, sortKey?: string): Promise<TEntity | undefined> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey) key[this.sortKey] = sortKey;

    const res = await getDdbClient().send(new GetCommand({
      TableName: this.tableName,
      Key: key,
    }));
    return res.Item as TEntity | undefined;
  }

  async put(item: TEntity, options?: { condition?: string }): Promise<void> {
    await getDdbClient().send(new PutCommand({
      TableName: this.tableName,
      Item: item as Record<string, unknown>,
      ConditionExpression: options?.condition,
    }));
  }

  async patch(
    partitionKey: string,
    sortKey: string | undefined,
    updates: Partial<TEntity>,
  ): Promise<void> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey) key[this.sortKey] = sortKey;

    const { expression, names, values } = buildUpdateExpression(updates);
    await getDdbClient().send(new UpdateCommand({
      TableName: this.tableName,
      Key: key,
      UpdateExpression: expression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }

  async delete(partitionKey: string, sortKey?: string): Promise<void> {
    const key: Record<string, string> = { [this.partitionKey]: partitionKey };
    if (this.sortKey && sortKey) key[this.sortKey] = sortKey;

    await getDdbClient().send(new DeleteCommand({
      TableName: this.tableName,
      Key: key,
    }));
  }

  async queryByIndex(
    indexName: string,
    partitionKey: string,
    partitionValue: string,
    options: {
      sortKey?: string;
      sortValue?: string;
      sortComparator?: "=" | "<" | ">" | "<=" | ">=" | "begins_with";
      limit?: number;
      nextToken?: string;
      scanIndexForward?: boolean;
    } = {},
  ): Promise<PaginatedResult<TEntity>> {
    // ... implementation
  }
}

// null/undefined/""/[] → DynamoDB REMOVE
function buildUpdateExpression(updates: Record<string, unknown>) {
  const sets: string[] = [];
  const removes: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    const attrName = `#${key}`;
    names[attrName] = key;

    if (value === null || value === undefined || value === "" ||
        (Array.isArray(value) && value.length === 0)) {
      removes.push(attrName);
    } else {
      const attrValue = `:${key}`;
      values[attrValue] = value;
      sets.push(`${attrName} = ${attrValue}`);
    }
  }

  const parts: string[] = [];
  if (sets.length) parts.push(`SET ${sets.join(", ")}`);
  if (removes.length) parts.push(`REMOVE ${removes.join(", ")}`);
  return { expression: parts.join(" "), names, values };
}
```

## Repository Pattern

Each table has a repository — a class extending `BaseRepository` with domain-specific methods:

```typescript
// packages/s-authn/core/src/users/users.repository.ts
import { BaseRepository } from "@s/shared/ddb";
import { Resource } from "sst";
import type { AuthnUser } from "./users.entity.js";

type AuthnUserKeys = { id: string };

class AuthnUsersRepository extends BaseRepository<AuthnUser, AuthnUserKeys> {
  constructor() {
    super({
      tableName: Resource.AuthnUsers.name,
      keyFields: { partitionKey: "id" },
    });
  }

  async findByEmail(email: string): Promise<AuthnUser | undefined> {
    const { items } = await this.queryByIndex("ByEmail", "email", email, { limit: 1 });
    return items[0];
  }
}

export const authnUsersRepository = new AuthnUsersRepository();
```

**Conventions:**

- One repository per table, singleton instance
- Repo is where DynamoDB is touched — **nothing else calls DDB directly**
- Repo methods return domain types or `undefined`/arrays — never raw DynamoDB responses
- Repo throws on infrastructure errors (DDB unreachable, etc.) — business validation lives in services

## Layer Boundaries

| Layer | Does | Does NOT |
|---|---|---|
| **Routes** (`functions/routes/`) | Parse/validate input, call ONE service method, format response | Touch DynamoDB, orchestrate multiple services |
| **Services** (`core/{feature}/`) | Business logic, orchestration, throw `DomainError`, publish events | Call `DynamoDBClient` directly, use `c.json()` |
| **Repositories** (`core/{feature}/`) | CRUD for ONE table | Business validation, cross-table queries |
| **Adapters** (`core/adapters/`) | Wrap external services with domain methods | Expose raw SDK calls |

**Cross-table reads inside a module are done in the service**, which calls multiple repositories. **Cross-module reads go via HTTP or events.**

## Entity Types

Entities are TypeScript interfaces describing document shape, with factory functions that create new instances:

```typescript
// packages/s-authn/core/src/users/users.entity.ts
import { ulid } from "ulid";

export interface AuthnUser {
  id: string;                // ULID, partition key
  email: string;             // GSI ByEmail
  passwordHash: string;      // argon2id
  enabled: boolean;
  emailVerified: boolean;
  createdAt: string;         // ISO 8601
  updatedAt: string;
}

export function createAuthnUser(params: {
  email: string;
  passwordHash: string;
}): AuthnUser {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    email: params.email,
    passwordHash: params.passwordHash,
    enabled: true,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  };
}
```

## IDs: ULID

Every entity has an `id` field that is a ULID:

```typescript
import { ulid } from "ulid";
const id = ulid(); // "01HXYZ5A1B2C3D4E5F6G7H8J9K"
```

**Properties:**

- 128-bit, 26-character Crockford Base32 string
- Lexicographically sortable by creation time
- Globally unique without coordination
- Monotonic within the same millisecond (on the same process)

**Benefits for DynamoDB:**

- Natural cursor pagination (lex sort = chronological)
- No hot partition from sequential IDs
- URL-safe

## Timestamps

All timestamp fields use ISO 8601 strings:

```typescript
const now = new Date().toISOString(); // "2026-04-17T10:30:00.000Z"
```

**Why strings over Date or unix:**

- Human-readable in logs and DynamoDB console
- Timezone-unambiguous (always UTC with `Z`)
- Directly serializable to JSON
- Sortable as strings (ISO 8601 is lexicographic-chronological)

**Special case: TTL fields** use Unix seconds (DynamoDB requirement):

```typescript
expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
```

## Cursor-Based Pagination

All list endpoints use cursor pagination via DynamoDB's `ExclusiveStartKey` → base64-encoded to `nextToken`:

```typescript
// packages/shared/src/ddb/pagination.ts
export function encodeNextToken(lastKey: Record<string, unknown> | undefined): string | undefined {
  if (!lastKey) return undefined;
  return Buffer.from(JSON.stringify(lastKey)).toString("base64url");
}

export function decodeNextToken(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  return JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
}
```

Usage in repository:

```typescript
async listUsers(options: { limit?: number; nextToken?: string }): Promise<PaginatedResult<AuthnUser>> {
  const res = await getDdbClient().send(new ScanCommand({
    TableName: this.tableName,
    Limit: Math.min(options.limit ?? 20, 100),
    ExclusiveStartKey: decodeNextToken(options.nextToken),
  }));
  return {
    items: (res.Items ?? []) as AuthnUser[],
    nextToken: encodeNextToken(res.LastEvaluatedKey),
  };
}
```

API response:

```json
{
  "data": [...],
  "metadata": {
    "nextToken": "eyJpZCI6IjAxSFhZWi..."
  }
}
```

Client passes `nextToken` as a query param for the next page.

**Pagination limits:**

- Default: 20
- Max: 100 (silently capped)
- Configurable: `?limit=50`

## TTL Documents

DynamoDB auto-deletes items with a TTL attribute set to a Unix timestamp:

```typescript
// Insert a document that expires in 24 hours
await authnRefreshTokensRepository.put({
  jtiHash: "...",
  userId: "...",
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
  // ...
});
```

DynamoDB runs TTL cleanup within 48 hours of expiration (not real-time). For strict expiry, check the TTL in application code as well.

**Use cases:**

- Refresh token records (24h TTL matches token expiry)
- Rate limit counters (sliding window TTL)
- Email verification codes (10min TTL)
- Processed event IDs for idempotency (1h TTL)

## Conflict Detection (Idempotent Writes)

Use conditional expressions for idempotent inserts:

```typescript
try {
  await authnUsersRepository.put(user, {
    condition: "attribute_not_exists(id)",
  });
} catch (err) {
  if (isConditionalCheckFailed(err)) {
    // Already exists — expected on retry
    return;
  }
  throw err;
}
```

Helper in `@s/shared/ddb`:

```typescript
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

export function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof ConditionalCheckFailedException;
}
```

## Search

### Default: DynamoDB GSI

For most "search" needs (lookup by indexed field), use a GSI:

```typescript
async findByEmail(email: string): Promise<AuthnUser | undefined> {
  const { items } = await this.queryByIndex("ByEmail", "email", email, { limit: 1 });
  return items[0];
}

async listUsersByStatus(status: "active" | "disabled"): Promise<PaginatedResult<AuthnUser>> {
  return this.queryByIndex("ByStatus", "status", status, { limit: 50 });
}
```

### Prefix search: use `begins_with`

```typescript
async findUsersByEmailPrefix(prefix: string): Promise<AuthnUser[]> {
  const res = await getDdbClient().send(new QueryCommand({
    TableName: this.tableName,
    IndexName: "ByEmail",
    KeyConditionExpression: "begins_with(email, :prefix)",
    ExpressionAttributeValues: { ":prefix": prefix },
    Limit: 20,
  }));
  return (res.Items ?? []) as AuthnUser[];
}
```

### Fallback: Algolia (when needed)

For full-text search, typo tolerance, faceting, large OR/IN queries, use Algolia. CQRS-lite pattern:

```
DynamoDB (source of truth) ──► Stream handler ──► Algolia (search index)
                                                       ▲
                                   Client ─────────────┘ (search queries)
```

**Only add Algolia when a module genuinely needs it.** Most modules should get by with GSIs.

Sync Lambda in `packages/s-{module}/functions/src/stream-handler.ts` writes to Algolia when the module needs search:

```typescript
import algoliasearch from "algoliasearch";

const algolia = algoliasearch(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_KEY!,
);
const index = algolia.initIndex(`${$app.stage}-users`);

async function syncToAlgolia(record: DynamoDBRecord): Promise<void> {
  if (record.eventName === "REMOVE") {
    await index.deleteObject(record.dynamodb!.Keys!.id.S!);
    return;
  }
  const item = unmarshall(record.dynamodb!.NewImage as never);
  await index.saveObject({ objectID: item.id, ...item });
}
```

See [02-technology-stack.md](02-technology-stack.md) for Algolia pricing.

## Common Access Pattern Examples

### Get by ID

```typescript
const user = await authnUsersRepository.get(userId);
```

### Get by alternate key (GSI)

```typescript
const user = await authnUsersRepository.findByEmail(email);
```

### List with pagination

```typescript
const { items, nextToken } = await authnUsersRepository.list({
  limit: 50,
  nextToken: req.query.nextToken,
});
```

### Count (aggregation — load all pages)

```typescript
async countActiveUsers(): Promise<number> {
  let count = 0;
  let nextToken: string | undefined;
  do {
    const { items, nextToken: next } = await this.queryByIndex(
      "ByStatus", "status", "active", { limit: 100, nextToken }
    );
    count += items.length;
    nextToken = next;
  } while (nextToken);
  return count;
}
```

**Note:** looping is only for aggregations (counts, totals). **Never** loop for list endpoints — return `nextToken` to the client.

### Conditional update

```typescript
await authnUsersRepository.patch(userId, undefined, {
  enabled: false,
  updatedAt: new Date().toISOString(),
});
```

### Atomic increment

```typescript
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

await getDdbClient().send(new UpdateCommand({
  TableName: rateLimitTable.name,
  Key: { key: `${ip}-login` },
  UpdateExpression: "ADD #count :one",
  ExpressionAttributeNames: { "#count": "count" },
  ExpressionAttributeValues: { ":one": 1 },
}));
```

## Forbidden Patterns

- ❌ Direct `DynamoDBClient` / `DynamoDBDocumentClient` usage outside `packages/shared/src/ddb/` and repositories
- ❌ Scan operations in user-facing endpoints (they read the whole table)
- ❌ Cross-module repository imports (each module owns its tables)
- ❌ Transactions spanning tables from different modules
- ❌ Hardcoded table names — use SST `Resource.{TableName}.name`
- ❌ Storing dates as numbers (except TTL fields)
- ❌ Using UUID v4 for IDs — use ULID
- ❌ Returning raw DDB `Items` responses — repos return typed entities

## Table Design Checklist (when adding a new table)

When defining a new table:

- [ ] Partition key designed for high cardinality (no hot partitions)
- [ ] `stream: "new-and-old-images"` enabled
- [ ] TTL attribute if rows should auto-expire
- [ ] Each GSI justified by an actual access pattern
- [ ] Sort key used if you need range queries
- [ ] Sparse index considered for low-cardinality filters (e.g., `active = "1"`)
- [ ] Capacity mode: on-demand (default) unless you have predictable load
