import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "@s/shared/ddb";
import { type LocalDynamo, createTable, startLocalDynamo } from "@s/shared/testing";
import type { EventBridgeEvent } from "aws-lambda";

/**
 * Consumer contract test.
 *
 * Loads s-authn's committed `events.asyncapi.json`, picks the example
 * payload for `user.registered`, wraps it in a PlatformEvent envelope +
 * EventBridge event shape, and passes it through s-user's event handler.
 * A passing test means: a producer publishing an event that matches the
 * AsyncAPI example will NOT break s-user's consumer. This catches shape
 * drift on the producer side during CI before deploy.
 *
 * The example comes from the generated contract file — regenerate with
 * `bun run contracts:build` whenever the producer's schema changes.
 */

const ASYNCAPI_PATH = "../../../s-authn/contracts/events.asyncapi.json";

const USER_PROFILES_TABLE = "UserProfiles-contract-test";

let dynamo: LocalDynamo;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported handler
let handler: any;

beforeAll(async () => {
  dynamo = await startLocalDynamo();

  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.USER_PROFILES_TABLE_NAME = USER_PROFILES_TABLE;

  await createTable(dynamo.endpoint, {
    tableName: USER_PROFILES_TABLE,
    partitionKey: "userId",
  });

  const mod = await import("@s-user/functions/event-handler");
  handler = mod.handler;
});

afterAll(async () => {
  await dynamo.stop();
});

describe("s-user accepts user.registered per s-authn's AsyncAPI", () => {
  test("producer example flows through the consumer handler and creates a profile", async () => {
    const asyncapi = JSON.parse(readFileSync(new URL(ASYNCAPI_PATH, import.meta.url), "utf-8")) as {
      components: {
        messages: Record<string, { examples: Array<{ payload: Record<string, unknown> }> }>;
      };
    };

    const examplePayload = asyncapi.components.messages.user_registered.examples[0]?.payload as {
      userId: string;
      email: string;
      occurredAt: string;
    };
    expect(examplePayload).toBeDefined();

    const event: EventBridgeEvent<string, unknown> = {
      version: "0",
      id: "contract-test-1",
      "detail-type": "user.registered",
      source: "s-authn",
      account: "000000000000",
      time: "2026-04-20T00:00:00Z",
      region: "local",
      resources: [],
      detail: {
        eventName: "user.registered",
        correlationId: "01HXYCORR00000000000000000",
        traceId: "01HXYTRACE0000000000000000",
        occurredAt: examplePayload.occurredAt,
        payload: examplePayload,
      },
    };

    // biome-ignore lint/suspicious/noExplicitAny: EventBridge detail is dynamic
    await handler(event as any);

    const row = await getDdbClient().send(
      new GetCommand({
        TableName: USER_PROFILES_TABLE,
        Key: { userId: examplePayload.userId },
      }),
    );
    expect(row.Item).toBeDefined();
    expect(row.Item?.userId).toBe(examplePayload.userId);
  });
});
