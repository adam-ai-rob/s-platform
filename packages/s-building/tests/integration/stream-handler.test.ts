import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { marshall } from "@aws-sdk/util-dynamodb";
import { type LocalDynamo, createTable, startLocalDynamo } from "@s/shared/testing";
import type { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import type { Building } from "../../core/src/buildings/buildings.entity";

/**
 * Structural subset of PutEventsCommand — avoids pulling
 * `@aws-sdk/client-eventbridge` into this package just for a test type.
 */
interface CapturedPutEvents {
  input: {
    Entries?: {
      Source?: string;
      DetailType?: string;
      Detail?: string;
      EventBusName?: string;
    }[];
  };
}

/**
 * Integration test: real DDB write → stream-handler → (mocked)
 * EventBridge PutEvents. The stream itself is simulated by marshalling
 * the repository's before/after state into a DynamoDBStreamEvent and
 * feeding it to the handler, because dynamodb-local doesn't surface
 * streams on the JVM-embedded JAR.
 *
 * What this proves beyond the unit test:
 *   - Repository writes round-trip through unmarshall() cleanly
 *   - The handler picks the correct EventBridge `Source` + `DetailType`
 *   - The full PlatformEvent envelope assembles without throwing
 *     (schema validation on the payload runs too)
 */

const BUILDINGS_TABLE = "Buildings-stream-test";
const STAGE = "dev";

let dynamo: LocalDynamo;
let handler: typeof import("../../functions/src/stream-handler")["handler"];
let repo: typeof import("../../core/src/buildings/buildings.repository")["buildingsRepository"];
let sent: CapturedPutEvents[] = [];

// Minimal EventBridge client stub that records every PutEventsCommand.
const fakeEventBridge = {
  send: async (cmd: CapturedPutEvents) => {
    sent.push(cmd);
    return { FailedEntryCount: 0, Entries: [] };
  },
};

function building(overrides: Partial<Building> = {}): Building {
  return {
    buildingId: "01HXYBUILDING00000000000000",
    name: "Karlín Tower",
    description: "Office building in Karlín district",
    address: {
      formatted: "Karlínské nám. 5, 186 00 Praha 8, Czech Republic",
      streetAddress: "Karlínské nám. 5",
      locality: "Praha",
      postalCode: "186 00",
      countryCode: "CZ",
      location: { lat: 50.0917, lng: 14.4547 },
    },
    areaSqm: 4200,
    population: 350,
    primaryLanguage: "en",
    supportedLanguages: ["en"],
    currency: "EUR",
    timezone: "Europe/Prague",
    status: "draft",
    createdAt: "2026-04-20T08:00:00.000Z",
    updatedAt: "2026-04-20T08:00:00.000Z",
    createdAtMs: 1_745_136_000_000,
    updatedAtMs: 1_745_136_000_000,
    ...overrides,
  };
}

const BUILDING_FIXTURE = building();

function streamEvent(records: DynamoDBRecord[]): DynamoDBStreamEvent {
  return { Records: records };
}

function insertRecord(row: Building): DynamoDBRecord {
  return {
    eventID: crypto.randomUUID(),
    eventName: "INSERT",
    dynamodb: {
      // biome-ignore lint/suspicious/noExplicitAny: marshall shape differs from Record<AttributeValue>
      NewImage: marshall(row) as any,
    },
  };
}

function modifyRecord(oldRow: Building, newRow: Building): DynamoDBRecord {
  return {
    eventID: crypto.randomUUID(),
    eventName: "MODIFY",
    dynamodb: {
      // biome-ignore lint/suspicious/noExplicitAny: see above
      OldImage: marshall(oldRow) as any,
      // biome-ignore lint/suspicious/noExplicitAny: see above
      NewImage: marshall(newRow) as any,
    },
  };
}

function removeRecord(oldRow: Building): DynamoDBRecord {
  return {
    eventID: crypto.randomUUID(),
    eventName: "REMOVE",
    dynamodb: {
      // biome-ignore lint/suspicious/noExplicitAny: see above
      OldImage: marshall(oldRow) as any,
    },
  };
}

beforeAll(async () => {
  dynamo = await startLocalDynamo();

  process.env.STAGE = STAGE;
  process.env.DDB_ENDPOINT = dynamo.endpoint;
  process.env.AWS_REGION = "local";
  process.env.BUILDINGS_TABLE_NAME = BUILDINGS_TABLE;
  process.env.EVENT_BUS_NAME = "platform-events-test";

  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();

  await createTable(dynamo.endpoint, {
    tableName: BUILDINGS_TABLE,
    partitionKey: "buildingId",
    attributeTypes: { status: "S", updatedAtMs: "N" },
    indexes: [{ indexName: "ByStatus", partitionKey: "status", sortKey: "updatedAtMs" }],
  });

  const events = await import("@s/shared/events");
  // biome-ignore lint/suspicious/noExplicitAny: fake client only implements send()
  events.__setEventBridgeClientForTests(fakeEventBridge as any);

  const mod = await import("@s-building/functions/stream-handler");
  handler = mod.handler;

  repo = (await import("@s-building/core/buildings/buildings.repository")).buildingsRepository;
});

afterAll(async () => {
  const events = await import("@s/shared/events");
  events.__resetEventBridgeClientForTests();
  const ddb = await import("@s/shared/ddb");
  ddb.__resetDdbClientForTests();
  await dynamo.stop();
});

function detailOf(cmd: CapturedPutEvents): {
  Source?: string;
  DetailType?: string;
  envelope: { eventName: string; payload: Record<string, unknown> };
} {
  const entry = cmd.input.Entries?.[0];
  return {
    Source: entry?.Source,
    DetailType: entry?.DetailType,
    envelope: JSON.parse(entry?.Detail ?? "{}"),
  };
}

describe("stream-handler (real DDB + fake EventBridge)", () => {
  test("INSERT against a real table round-trips to building.created", async () => {
    sent = [];
    await repo.insert(BUILDING_FIXTURE);
    const stored = await repo.findById(BUILDING_FIXTURE.buildingId);
    expect(stored?.status).toBe("draft");

    await handler(streamEvent([insertRecord(BUILDING_FIXTURE)]));

    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one captured PutEvents");
    const d = detailOf(first);
    expect(d.Source).toBe("s-building");
    expect(d.DetailType).toBe("building.created");
    expect(d.envelope.payload).toEqual({
      buildingId: BUILDING_FIXTURE.buildingId,
      status: "draft",
    });
    expect(d.envelope.eventName).toBe("building.created");
  });

  test("MODIFY with draft→active emits updated + activated in order", async () => {
    sent = [];
    const next = building({ status: "active", updatedAtMs: 1_745_140_000_000 });
    await handler(streamEvent([modifyRecord(BUILDING_FIXTURE, next)]));

    expect(sent.map((c) => detailOf(c).DetailType)).toEqual([
      "building.updated",
      "building.activated",
    ]);
  });

  test("MODIFY active→archived emits updated + archived", async () => {
    sent = [];
    const active: Building = building({ status: "active" });
    const archived: Building = building({ status: "archived" });
    await handler(streamEvent([modifyRecord(active, archived)]));

    expect(sent.map((c) => detailOf(c).DetailType)).toEqual([
      "building.updated",
      "building.archived",
    ]);
  });

  test("REMOVE emits building.deleted carrying id from OldImage", async () => {
    sent = [];
    await handler(streamEvent([removeRecord(BUILDING_FIXTURE)]));

    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error("expected one captured PutEvents");
    const d = detailOf(first);
    expect(d.DetailType).toBe("building.deleted");
    expect(d.envelope.payload).toEqual({ buildingId: BUILDING_FIXTURE.buildingId });
  });

  test("batch of records is processed in-order", async () => {
    sent = [];
    const active: Building = building({ status: "active" });
    await handler(
      streamEvent([
        insertRecord(BUILDING_FIXTURE),
        modifyRecord(BUILDING_FIXTURE, active),
        removeRecord(active),
      ]),
    );
    expect(sent.map((c) => detailOf(c).DetailType)).toEqual([
      "building.created",
      "building.updated",
      "building.activated",
      "building.deleted",
    ]);
  });
});
