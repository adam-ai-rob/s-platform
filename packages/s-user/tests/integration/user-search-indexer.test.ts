import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type LocalDynamo, createTable, startLocalDynamo } from "@s/shared/testing";
import type { EventBridgeEvent } from "aws-lambda";
import { createFakeTypesenseClient } from "./fake-typesense";

/**
 * Integration test for the search indexer Lambda handler.
 *
 * Drives the handler through the three lifecycle events
 * (`user.profile.created` / `user.profile.updated` / `user.profile.deleted`)
 * against a real local DynamoDB (for the profile lookup on upsert) and a
 * fake in-memory Typesense client (to verify the correct write paths).
 *
 * Proves that:
 *   - create/update fetch the profile from DDB and upsert into search
 *   - delete drops the document directly by userId (no DDB read)
 *   - a race where the profile has been deleted between publish and
 *     consume is handled silently (skip, no throw)
 */

const USER_PROFILES_TABLE = "UserProfiles-test";
const STAGE = "dev";
const COLLECTION = `${STAGE}_users`;
const TEST_USER_ID = "01HXINDEXER0000000000000000";

let dynamo: LocalDynamo;
let fakeClient: ReturnType<typeof createFakeTypesenseClient>;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported handler
let handler: any;
// biome-ignore lint/suspicious/noExplicitAny: dynamic-imported repo
let repo: any;

function makeEvent(
  eventName: "user.profile.created" | "user.profile.updated" | "user.profile.deleted",
  userId: string,
): EventBridgeEvent<string, unknown> {
  return {
    version: "0",
    id: crypto.randomUUID(),
    "detail-type": eventName,
    source: "s-user",
    account: "000000000000",
    time: new Date().toISOString(),
    region: "local",
    resources: [],
    detail: {
      eventName,
      correlationId: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { userId },
    },
  } as EventBridgeEvent<string, unknown>;
}

beforeAll(async () => {
  dynamo = await startLocalDynamo();

  process.env.STAGE = STAGE;
  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.USER_PROFILES_TABLE_NAME = USER_PROFILES_TABLE;

  // Bun shares process state across test files — drop cached singletons.
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();

  await createTable(dynamo.endpoint, {
    tableName: USER_PROFILES_TABLE,
    partitionKey: "userId",
  });

  // Seed Typesense fake with the (empty) target collection so the
  // indexer's `ensureUsersCollection()` retrieve succeeds instead of
  // trying to create against the fake.
  fakeClient = createFakeTypesenseClient({
    collections: {
      [COLLECTION]: [],
    },
  });

  const search = await import("@s/shared/search");
  search.__setClientsForTests({ admin: fakeClient.client });

  const mod = await import("@s-user/functions/search-indexer");
  handler = mod.handler;

  repo = (await import("@s-user/core/profiles/profiles.repository")).userProfilesRepository;

  // Seed a profile row for the upsert path.
  await repo.insert({
    userId: TEST_USER_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    preferences: {},
    metadata: {},
    createdAt: "2026-04-22T08:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z",
  });
});

afterAll(async () => {
  const search = await import("@s/shared/search");
  search.__resetClientCacheForTests();
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  await dynamo.stop();
});

describe("search-indexer handler (integration, fake Typesense)", () => {
  test("user.profile.created → upserts the document from DDB", async () => {
    await handler(makeEvent("user.profile.created", TEST_USER_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_USER_ID) as { displayName?: string } | undefined;
    expect(doc?.displayName).toBe("Ada Lovelace");
  });

  test("user.profile.updated → re-upserts with the latest DDB state", async () => {
    await repo.update(TEST_USER_ID, { firstName: "Grace", lastName: "Hopper" });
    await handler(makeEvent("user.profile.updated", TEST_USER_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    const doc = col?.docs.get(TEST_USER_ID) as { firstName?: string } | undefined;
    expect(doc?.firstName).toBe("Grace");
  });

  test("user.profile.deleted → drops the document", async () => {
    await handler(makeEvent("user.profile.deleted", TEST_USER_ID));
    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.has(TEST_USER_ID)).toBe(false);
  });

  test("delete is idempotent when the document is already gone", async () => {
    // Already deleted above — repeating should not throw.
    await handler(makeEvent("user.profile.deleted", TEST_USER_ID));
  });

  test("create for a userId that is not in DDB is skipped (race-safe)", async () => {
    const ghost = "01HXGHOST00000000000000000";
    await handler(makeEvent("user.profile.created", ghost));
    const col = fakeClient.state.collections.get(COLLECTION);
    expect(col?.docs.has(ghost)).toBe(false);
  });
});
