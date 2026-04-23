#!/usr/bin/env bun
/**
 * Build per-module contract artifacts — OpenAPI + AsyncAPI.
 *
 * For each module:
 *   1. Import its Hono app from `packages/s-{module}/functions/src/api.ts`
 *      and call `getOpenAPIDocument()` → write to
 *      `packages/s-{module}/contracts/openapi.json`.
 *   2. Import its event catalog from
 *      `packages/s-{module}/core/src/events.ts`, convert each Zod schema
 *      to JSON Schema, wrap in an AsyncAPI 3.0 document → write to
 *      `packages/s-{module}/contracts/events.asyncapi.json`.
 *
 * The generated files are committed to git — they ARE the versioned
 * contract artifacts consumed by downstream modules' contract tests.
 *
 * Run:
 *   bun run contracts:build
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Every module's repositories read their table name from env vars at
 * construction time. Loading a module's `api.ts` therefore triggers
 * those reads. Set dummy values so the imports succeed — no AWS calls
 * happen during harvest; we just need the app object for its
 * `getOpenAPIDocument()` method.
 */
const DUMMY_ENV: Record<string, string> = {
  AWS_REGION: "us-east-1",
  EVENT_BUS_NAME: "contract-harvest",
  AUTHN_URL: "https://contract-harvest.local",
  KMS_KEY_ALIAS: "alias/contract-harvest",
  AUTHN_USERS_TABLE_NAME: "contract-harvest-authn-users",
  AUTHN_REFRESH_TOKENS_TABLE_NAME: "contract-harvest-authn-refresh-tokens",
  USER_PROFILES_TABLE_NAME: "contract-harvest-user-profiles",
  AUTHZ_ROLES_TABLE_NAME: "contract-harvest-authz-roles",
  AUTHZ_USER_ROLES_TABLE_NAME: "contract-harvest-authz-user-roles",
  AUTHZ_GROUP_ROLES_TABLE_NAME: "contract-harvest-authz-group-roles",
  AUTHZ_VIEW_TABLE_NAME: "contract-harvest-authz-view",
  GROUPS_TABLE_NAME: "contract-harvest-groups",
  GROUP_USERS_TABLE_NAME: "contract-harvest-group-users",
  BUILDINGS_TABLE_NAME: "contract-harvest-buildings",
};
for (const [k, v] of Object.entries(DUMMY_ENV)) {
  if (!process.env[k]) process.env[k] = v;
}

interface EventCatalogEntry {
  schema: ZodType;
  summary: string;
  example: Record<string, unknown>;
}

type EventCatalog = Record<string, EventCatalogEntry>;

interface ModuleConfig {
  name: string;
  title: string;
  version: string;
  appPath: string;
  catalogPath: string;
  catalogExport: string;
  contractsDir: string;
}

const ROOT = new URL("..", import.meta.url).pathname;

const modules: ModuleConfig[] = [
  {
    name: "s-authn",
    title: "s-authn event contract",
    version: "1.0.0",
    appPath: `${ROOT}packages/s-authn/functions/src/api.ts`,
    catalogPath: `${ROOT}packages/s-authn/core/src/events.ts`,
    catalogExport: "authnEventCatalog",
    contractsDir: `${ROOT}packages/s-authn/contracts`,
  },
  {
    name: "s-user",
    title: "s-user event contract",
    version: "1.0.0",
    appPath: `${ROOT}packages/s-user/functions/src/api.ts`,
    catalogPath: `${ROOT}packages/s-user/core/src/events.ts`,
    catalogExport: "userEventCatalog",
    contractsDir: `${ROOT}packages/s-user/contracts`,
  },
  {
    name: "s-authz",
    title: "s-authz event contract",
    version: "1.0.0",
    appPath: `${ROOT}packages/s-authz/functions/src/api.ts`,
    catalogPath: `${ROOT}packages/s-authz/core/src/events.ts`,
    catalogExport: "authzEventCatalog",
    contractsDir: `${ROOT}packages/s-authz/contracts`,
  },
  {
    name: "s-group",
    title: "s-group event contract",
    version: "1.0.0",
    appPath: `${ROOT}packages/s-group/functions/src/api.ts`,
    catalogPath: `${ROOT}packages/s-group/core/src/events.ts`,
    catalogExport: "groupEventCatalog",
    contractsDir: `${ROOT}packages/s-group/contracts`,
  },
  {
    name: "s-building",
    title: "s-building event contract",
    version: "1.0.0",
    appPath: `${ROOT}packages/s-building/functions/src/api.ts`,
    catalogPath: `${ROOT}packages/s-building/core/src/events.ts`,
    catalogExport: "buildingEventCatalog",
    contractsDir: `${ROOT}packages/s-building/contracts`,
  },
];

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  ✓ ${path.replace(ROOT, "")}`);
}

async function buildOpenApi(mod: ModuleConfig): Promise<void> {
  const { default: app } = (await import(mod.appPath)) as {
    default: {
      getOpenAPIDocument: (config: Record<string, unknown>) => Record<string, unknown>;
    };
  };

  const doc = app.getOpenAPIDocument({
    openapi: "3.1.0",
    info: {
      title: `${mod.name} HTTP API`,
      version: mod.version,
    },
  });

  writeJson(`${mod.contractsDir}/openapi.json`, doc);
}

async function buildAsyncApi(mod: ModuleConfig): Promise<void> {
  const catalogModule = (await import(mod.catalogPath)) as Record<string, EventCatalog>;
  const catalog = catalogModule[mod.catalogExport];
  if (!catalog) {
    throw new Error(`${mod.catalogExport} not exported from ${mod.catalogPath}`);
  }

  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};

  for (const [eventName, entry] of Object.entries(catalog)) {
    const schemaKey = eventName.replace(/\./g, "_");
    const jsonSchema = zodToJsonSchema(entry.schema, {
      $refStrategy: "none",
    });

    schemas[schemaKey] = jsonSchema;

    messages[schemaKey] = {
      name: eventName,
      title: eventName,
      summary: entry.summary,
      contentType: "application/json",
      payload: { $ref: `#/components/schemas/${schemaKey}` },
      examples: [{ name: "default", payload: entry.example }],
    };

    channels[eventName] = {
      address: eventName,
      description: entry.summary,
      messages: {
        [schemaKey]: { $ref: `#/components/messages/${schemaKey}` },
      },
    };

    operations[`send_${schemaKey}`] = {
      action: "send",
      channel: { $ref: `#/channels/${eventName}` },
      messages: [{ $ref: `#/channels/${eventName}/messages/${schemaKey}` }],
    };
  }

  const doc = {
    asyncapi: "3.0.0",
    info: {
      title: mod.title,
      version: mod.version,
      description: `Events published by ${mod.name} onto the platform EventBridge bus. Payloads are wrapped in the PlatformEvent envelope (see packages/shared/src/events/envelope.ts); each payload below matches PlatformEvent.payload.`,
    },
    defaultContentType: "application/json",
    channels,
    operations,
    components: {
      messages,
      schemas,
    },
  };

  writeJson(`${mod.contractsDir}/events.asyncapi.json`, doc);
}

/**
 * Bun resolves `paths` from the nearest tsconfig, but the resolution
 * anchor is the *invoking* process's cwd, not the imported file. So we
 * spawn a worker `bun` per module from within that module's directory.
 * The worker runs this same script with a single-module filter.
 */
async function spawnPerModule(): Promise<void> {
  const { spawn } = await import("node:child_process");
  for (const mod of modules) {
    await new Promise<void>((resolve, reject) => {
      console.log(`\n[${mod.name}]`);
      const packageDir = `${ROOT}packages/${mod.name}`;
      const child = spawn("bun", ["run", `${ROOT}scripts/build-contracts.ts`], {
        cwd: packageDir,
        env: { ...process.env, BUILD_CONTRACTS_ONLY: mod.name },
        stdio: "inherit",
      });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${mod.name} build failed`)),
      );
    });
  }
}

async function main(): Promise<void> {
  const only = process.env.BUILD_CONTRACTS_ONLY;

  if (!only) {
    // Top-level invocation: fan out to per-module workers so tsconfig
    // path aliases (@s-{name}/*) resolve correctly.
    await spawnPerModule();
    console.log("\n✅ Contracts built.\n");
    return;
  }

  const mod = modules.find((m) => m.name === only);
  if (!mod) {
    throw new Error(`Unknown module: ${only}`);
  }
  await buildOpenApi(mod);
  await buildAsyncApi(mod);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
