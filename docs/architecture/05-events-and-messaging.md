# Events & Messaging

Modules communicate asynchronously via a shared EventBridge bus. Events originate from DynamoDB Streams (change data capture) — the source of truth is the database write, not a separate publish step. This document covers the event envelope, naming conventions, stream-to-bus pipeline, idempotency, and backpressure handling.

## Architecture

```
Module A writes to DynamoDB
      │
      │  DynamoDB Streams (NEW_AND_OLD_IMAGES)
      ▼
Module A stream-handler Lambda
      │
      │  build PlatformEvent envelope
      │  publish to EventBridge bus
      ▼
EventBridge custom bus: `platform-events-{stage}`
      │
      │  rule-based routing
      │  (pattern matches source + detail-type)
      ▼
SQS queue (per consumer, optional — for backpressure)
      │
      ▼
Module B event-handler Lambda
      │
      ▼
Module B applies side effect (e.g., creates profile)
```

## Why This Shape

- **DDB Streams as source:** guarantees every DB write produces (eventually) an event. No "forgot to publish" bugs. The write is the event.
- **EventBridge as router:** decouples publishers from subscribers. New consumers subscribe without touching the publisher.
- **SQS between rule and Lambda (optional):** buffers events during spikes; enables Lambda concurrency limits and DLQ.
- **Per-consumer handler:** each subscriber has its own Lambda with scoped IAM. Failures in one don't block others.

## Platform Event Envelope

Every event published to EventBridge follows the same envelope:

```typescript
// @s/shared/events/envelope.ts
export interface PlatformEvent<T = unknown> {
  eventName: string;       // "user.registered", "group.user.activated"
  correlationId: string;   // ULID — stable across retries
  traceId: string;         // W3C traceparent trace ID
  occurredAt: string;      // ISO 8601 timestamp
  payload: T;              // event-specific data
}
```

**Field details:**

- `eventName` — identifies the event type. Consumers route by this.
- `correlationId` — ULID generated when the event is first created. Stable across retries. Consumers use this for idempotency.
- `traceId` — from the original request's `traceparent` header. Links the event back to the request in CloudWatch.
- `occurredAt` — when the domain event happened (not when published).
- `payload` — event-specific, typed per event.

## EventBridge Event Structure

EventBridge wraps our envelope with its own metadata. The full structure published:

```typescript
await eventBridge.putEvents({
  Entries: [{
    EventBusName: "platform-events-dev",
    Source: "s-authn",                      // module that published
    DetailType: "user.registered",          // same as envelope.eventName
    Detail: JSON.stringify({
      eventName: "user.registered",
      correlationId: "01HXYZ...",
      traceId: "abc...",
      occurredAt: "2026-04-16T10:30:00.000Z",
      payload: { userId: "01HABC...", email: "alice@example.com" },
    }),
  }],
});
```

**Why duplicate `eventName` in DetailType:** EventBridge rules match on `source` + `detail-type`. Having `eventName` also in the Detail body keeps the envelope self-contained for archive/replay.

## Event Naming Convention

```
{domain}.{entity}.{past-tense-verb}
```

Events describe something that **already happened**. Always past tense.

**Examples:**

| Event Name | Published By | Description |
|---|---|---|
| `user.registered` | s-authn | New user account created |
| `user.email.verified` | s-authn | User's email was verified |
| `user.password.changed` | s-authn | User changed their password |
| `user.disabled` | s-authn | User account disabled |
| `user.enabled` | s-authn | User account re-enabled |
| `user.magic-link.requested` | s-authn | Magic link requested (triggers email) |
| `group.created` | s-group | New group created |
| `group.user.activated` | s-group | User added to group |
| `group.user.deactivated` | s-group | User removed from group |
| `authz.view.rebuilt` | s-authz | authz-view rebuilt for a user |

## Stream Handler Pattern

Each module has a stream handler Lambda that reads its DynamoDB Streams and publishes to EventBridge.

### SST Definition

```typescript
// infra/s-authn.ts
import { platformEventBus } from "./shared.js";
import { authnUsersTable, authnRefreshTokensTable } from "./database.js";

export const authnStreamHandler = new sst.aws.Function("AuthnStreamHandler", {
  link: [authnUsersTable, platformEventBus],
  handler: "packages/s-authn/functions/src/stream-handler.handler",
  environment: { STAGE: $app.stage },
});

new aws.lambda.EventSourceMapping("AuthnUsersStreamMapping", {
  eventSourceArn: authnUsersTable.nodes.table.streamArn,
  functionName: authnStreamHandler.nodes.function.arn,
  startingPosition: "LATEST",
  batchSize: 10,
  maximumRetryAttempts: 3,
  maximumRecordAgeInSeconds: 3600,
});
```

### Handler Code

```typescript
// packages/s-authn/functions/src/stream-handler.ts
import type { DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { publishEvent } from "@s/shared/events";
import { logger } from "@s/shared/logger";

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      logger.error("Failed to process stream record", {
        errorCode: "STREAM_HANDLER_FAILED",
        recordId: record.eventID,
        errorMessage: (err as Error).message,
      });
      // Let Lambda retry — don't swallow
      throw err;
    }
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") return;

  const newImage = record.dynamodb?.NewImage
    ? unmarshall(record.dynamodb.NewImage as never)
    : null;
  const oldImage = record.dynamodb?.OldImage
    ? unmarshall(record.dynamodb.OldImage as never)
    : null;

  // Decide what event to publish based on table + transition
  if (record.eventSourceARN?.includes("authn-users")) {
    if (record.eventName === "INSERT") {
      await publishEvent({
        eventName: "user.registered",
        source: "s-authn",
        payload: {
          userId: newImage!.id,
          email: newImage!.email,
        },
      });
    } else if (record.eventName === "MODIFY") {
      // Detect enabled flip, email verified, etc.
      if (oldImage!.enabled && !newImage!.enabled) {
        await publishEvent({
          eventName: "user.disabled",
          source: "s-authn",
          payload: { userId: newImage!.id },
        });
      }
      // ... other transition detections
    }
  }
}
```

### Publish Helper

```typescript
// packages/shared/src/events/publish.ts
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ulid } from "ulid";

const client = new EventBridgeClient({});

export async function publishEvent(params: {
  eventName: string;
  source: string;
  payload: unknown;
  correlationId?: string;
  traceId?: string;
}): Promise<void> {
  const detail = {
    eventName: params.eventName,
    correlationId: params.correlationId ?? ulid(),
    traceId: params.traceId ?? ulid(),
    occurredAt: new Date().toISOString(),
    payload: params.payload,
  };

  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.EVENT_BUS_NAME!,
      Source: params.source,
      DetailType: params.eventName,
      Detail: JSON.stringify(detail),
    }],
  }));
}
```

## EventBridge Rules (Subscribers)

Each subscriber defines a rule in its stack:

```typescript
// infra/s-user.ts
import { platformEventBus } from "./shared.js";

export const userEventHandler = new sst.aws.Function("UserEventHandler", {
  link: [userProfilesTable],
  handler: "packages/s-user/functions/src/event-handler.handler",
});

// Subscribe to user.registered from s-authn
new aws.cloudwatch.EventRule("UserOnUserRegistered", {
  eventBusName: platformEventBus.name,
  eventPattern: JSON.stringify({
    source: ["s-authn"],
    "detail-type": ["user.registered"],
  }),
});

new aws.cloudwatch.EventTarget("UserOnUserRegisteredTarget", {
  rule: "UserOnUserRegistered",
  eventBusName: platformEventBus.name,
  arn: userEventHandler.nodes.function.arn,
});

new aws.lambda.Permission("UserEventHandlerInvoke", {
  action: "lambda:InvokeFunction",
  function: userEventHandler.nodes.function.name,
  principal: "events.amazonaws.com",
  sourceArn: // rule ARN
});
```

## Event Handler Pattern

```typescript
// packages/s-user/functions/src/event-handler.ts
import type { EventBridgeEvent } from "aws-lambda";
import { handleUserRegistered } from "@s-user/core/profile/profile.service.js";
import { logger } from "@s/shared/logger";

export async function handler(event: EventBridgeEvent<string, never>): Promise<void> {
  const detail = event.detail as PlatformEvent;

  logger.info("📨 Event received", {
    eventName: detail.eventName,
    correlationId: detail.correlationId,
    traceId: detail.traceId,
  });

  try {
    switch (detail.eventName) {
      case "user.registered":
        await handleUserRegistered(detail.payload as UserRegisteredPayload);
        break;
      default:
        logger.debug("Unhandled event", { eventName: detail.eventName });
    }
  } catch (err) {
    logger.error("Event handler failed", {
      eventName: detail.eventName,
      correlationId: detail.correlationId,
      errorMessage: (err as Error).message,
    });
    throw err; // Let Lambda retry
  }
}
```

## Idempotency

All event handlers **must** be idempotent. Retries will happen (DDB Streams + EventBridge both provide at-least-once delivery).

### Three idempotency patterns

#### 1. Natural idempotency (preferred)

Operation produces the same result regardless of how many times it runs:

```typescript
// Overwriting a denormalized view
export async function rebuildAuthzView(userId: string): Promise<void> {
  const permissions = await computePermissions(userId);
  await AuthzViewRepository.put({ userId, permissions, updatedAt: now() });
  // Running this twice is safe — second write just overwrites with same data
}
```

#### 2. Conflict detection

Detect duplicates at insertion:

```typescript
export async function createProfile(userId: string, email: string): Promise<void> {
  try {
    await UserProfileRepository.put(
      { userId, email, createdAt: now() },
      { condition: "attribute_not_exists(userId)" },
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      logger.info("Profile already exists (idempotent)", { userId });
      return; // expected on retry
    }
    throw err;
  }
}
```

#### 3. Correlation ID tracking

For operations without natural idempotency, track processed event IDs:

```typescript
// @s/shared/events/processed.ts
export async function markProcessed(correlationId: string, ttlSeconds = 3600): Promise<boolean> {
  try {
    await ProcessedEventsRepository.put(
      {
        correlationId,
        expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
      },
      { condition: "attribute_not_exists(correlationId)" },
    );
    return true; // first time
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // duplicate
    throw err;
  }
}

// Usage in event handler
if (!(await markProcessed(event.correlationId))) {
  logger.info("Skipping duplicate event", { correlationId: event.correlationId });
  return;
}
await doSideEffect();
```

Store `ProcessedEvents` table in `@s/shared` as a convenience; TTL auto-expires entries.

## Backpressure Handling

For handlers that may be overwhelmed by event bursts, put an SQS queue between EventBridge and Lambda:

```typescript
// infra/s-user.ts
const userEventQueue = new sst.aws.Queue("UserEventQueue", {
  visibilityTimeout: "60 seconds",
  dlq: {
    queue: userEventDLQ,
    retry: 5,
  },
});

userEventQueue.subscribe("packages/s-user/functions/src/event-handler.handler", {
  batch: { size: 10, window: "5 seconds" },
});

new aws.cloudwatch.EventTarget("UserOnUserRegisteredTarget", {
  rule: "UserOnUserRegistered",
  eventBusName: platformEventBus.name,
  arn: userEventQueue.arn,  // → queue, not Lambda directly
});
```

Benefits:

- SQS buffers events during spikes (up to ~14 days)
- Lambda reserved concurrency limits throughput
- DLQ catches permanent failures
- Batch processing amortizes Lambda invocation overhead

**When to use:**

- Handler is slow (> 1 second per event)
- Downstream service has rate limits
- Spikes of 100+ events expected

**When to skip** (direct Lambda target):

- Low volume (< 10 events/sec peak)
- Fast handler (< 100ms)
- Simplicity matters more than resilience

## Dead-Letter Queue (DLQ)

Every async Lambda has a DLQ:

```typescript
export const userEventHandler = new sst.aws.Function("UserEventHandler", {
  link: [userProfilesTable, userEventDLQ],
  handler: "packages/s-user/functions/src/event-handler.handler",
  deadLetter: userEventDLQ.arn,
  // ...
});
```

Events that fail all retries end up in the DLQ. A CloudWatch alarm on DLQ message count alerts operators.

Manual replay: use the `scripts/replay-dlq.sh` helper (to be added).

## Event Topology (Current)

| Publisher | Event | Subscribers |
|---|---|---|
| s-authn | `user.registered` | s-user (create profile), s-group (check domain auto-assign) |
| s-authn | `user.email.verified` | (audit log only, no active subscribers) |
| s-authn | `user.disabled` | s-authz (rebuild authz-view to remove permissions) |
| s-authn | `user.enabled` | s-authz (rebuild authz-view to restore permissions) |
| s-authn | `user.magic-link.requested` | s-email (send magic link email — future module) |
| s-authn | `user.password.reset-requested` | s-email (send reset email) |
| s-authn | `user.email.verify-requested` | s-email (send verification email) |
| s-group | `group.user.activated` | s-authz (rebuild authz-view with group permissions) |
| s-group | `group.user.deactivated` | s-authz (rebuild authz-view to remove group permissions) |
| s-authz | `authz.view.rebuilt` | (no active subscribers — available for audit) |

Each module's `/info` endpoint must declare its `events.publishes` and `events.subscribes` arrays. Agents maintain this contract.

## Adding a New Event

Steps:

### 1. Define the payload type

```typescript
// packages/s-{module}/core/src/events/payloads.ts
export type UserEmailVerifiedPayload = {
  userId: string;
  email: string;
  verifiedAt: string;
};
```

### 2. Detect the transition in stream handler

Update `packages/s-{module}/functions/src/stream-handler.ts` to detect the DB write pattern and publish the event.

### 3. Subscribe in the consumer module

Add an EventBridge rule in the consumer's `infra/s-{consumer}.ts` and a handler branch in its `event-handler.ts`.

### 4. Update `/info` contract

Update the publishing module's `/info` endpoint `events.publishes` and the consumer's `events.subscribes`.

### 5. Update s-tests journey

Add an assertion in the appropriate journey test in `packages/s-tests/src/journeys/`.

### 6. Update this doc's topology table

Keep the event topology current.

## Replay and Archive

EventBridge Archive + Replay is configured for `platform-events`:

- All events archived for 90 days
- Replay to a specific rule or all rules via console or CLI
- Useful for: new subscriber needing historical data, debugging lost events

```typescript
// infra/shared.ts
const archive = new aws.cloudwatch.EventArchive("PlatformEventArchive", {
  eventSourceArn: platformEventBus.arn,
  retentionDays: 90,
});
```

## Observability

Every event flow emits logs with the `correlationId` and `traceId`. Tracing a single event end-to-end:

```
1. Find the stream handler log: correlationId=01HXYZ
2. Find the EventBridge invocation: EventId matches
3. Find the consumer handler log: same correlationId
4. X-Ray links them into a single trace
```

See [06-logging-and-observability.md](06-logging-and-observability.md).
