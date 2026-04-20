#!/usr/bin/env bun
/**
 * Contract backwards-compatibility check.
 *
 * Compares each module's committed OpenAPI + AsyncAPI contracts against
 * `origin/main` and flags potentially-breaking changes:
 *
 *   OpenAPI:
 *     - Removed path
 *     - Removed method on a kept path
 *     - Removed or renamed required response field
 *     - Narrowed type of a required response field
 *     - Removed enum value from a required response field
 *
 *   AsyncAPI:
 *     - Removed channel / event
 *     - Removed or renamed required event-payload field
 *     - Narrowed type of a required event-payload field
 *     - Removed enum value from a required payload field
 *
 * Consumer of an event cares about the payload shape they READ. If a
 * publisher removes or renames a field the consumer reads, the consumer
 * breaks. So the "removed / narrowed required field" rule is the key one.
 *
 * Additive changes (new endpoint, new event, new optional field, widened
 * enum) are safe by definition and not flagged.
 *
 * Usage:
 *
 *   bun run scripts/contract-diff.ts
 *     → Exit 0 if no breaks, 1 if breaks found.
 *
 * In CI: set `CONTRACT_DIFF_ALLOW_BREAKING=1` (the ci.yml step sets this
 * when the PR carries a `breaking-api-change` label) to downgrade errors
 * to warnings. Purely a failsafe — the label check itself lives in CI.
 */

import { execSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

const MODULES = ["authn", "authz", "user", "group"] as const;
const ALLOW_BREAKING = process.env.CONTRACT_DIFF_ALLOW_BREAKING === "1";

// ── Load helpers ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

async function loadFromMain(path: string): Promise<Json | null> {
  try {
    const content = execSync(`git show origin/main:${path}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return JSON.parse(content) as Json;
  } catch {
    // File didn't exist on main — this is a new contract, not a break.
    return null;
  }
}

async function loadFromPr(path: string): Promise<Json | null> {
  try {
    await access(path, constants.R_OK);
    return JSON.parse(await readFile(path, "utf8")) as Json;
  } catch {
    return null;
  }
}

// ── Schema walkers ────────────────────────────────────────────────────────────

/**
 * Resolve a `$ref` to the referenced node inside the same document.
 * Supports only local refs (`#/components/schemas/X`), which is all the
 * build-contracts script produces.
 */
function resolveRef(doc: Json, ref: string): Json | null {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let cur: unknown = doc;
  for (const p of parts) {
    if (typeof cur !== "object" || cur === null) return null;
    cur = (cur as Json)[p];
  }
  return (cur as Json) ?? null;
}

function deref(doc: Json, node: Json | null): Json | null {
  if (!node) return null;
  if (typeof node.$ref === "string") return resolveRef(doc, node.$ref);
  return node;
}

/**
 * Compare two schema nodes at a given JSON path and push breaking
 * change descriptions. Schemas are JSON Schema subset — object with
 * `type`, `properties`, `required`, `enum`, `items`.
 *
 * Recurses into nested objects and arrays.
 */
function diffSchema(
  prevDoc: Json,
  currDoc: Json,
  prev: Json | null,
  curr: Json | null,
  path: string,
  breaks: string[],
): void {
  const p = deref(prevDoc, prev);
  const c = deref(currDoc, curr);
  if (!p || !c) return;

  // Type narrowing (string → number, array widened → restricted, etc.)
  if (typeof p.type === "string" && typeof c.type === "string" && p.type !== c.type) {
    breaks.push(`${path}: type narrowed from '${p.type}' to '${c.type}'`);
  }

  // Enum narrowing — any value removed is a break (consumers may rely on it).
  if (Array.isArray(p.enum) && Array.isArray(c.enum)) {
    const removed = (p.enum as unknown[]).filter((v) => !(c.enum as unknown[]).includes(v));
    if (removed.length > 0) {
      breaks.push(`${path}: enum values removed: ${JSON.stringify(removed)}`);
    }
  }

  // Object required-field removals.
  const pProps = (p.properties as Json | undefined) ?? {};
  const cProps = (c.properties as Json | undefined) ?? {};
  const pRequired: string[] = Array.isArray(p.required) ? (p.required as string[]) : [];
  const cRequired: string[] = Array.isArray(c.required) ? (c.required as string[]) : [];

  for (const key of pRequired) {
    if (!(key in cProps)) {
      breaks.push(`${path}.${key}: required field removed`);
    } else if (!cRequired.includes(key)) {
      // Still present but no longer required. Producer side: this is fine
      // (now it may be absent; consumer reading it needs to handle absence).
      // Consumer side: their code reading this field may crash on undefined.
      // Treat as break.
      breaks.push(`${path}.${key}: required field became optional`);
    }
  }

  // Recurse into properties that exist in both.
  for (const key of Object.keys(pProps)) {
    if (key in cProps) {
      diffSchema(
        prevDoc,
        currDoc,
        pProps[key] as Json,
        cProps[key] as Json,
        `${path}.${key}`,
        breaks,
      );
    }
  }

  // Array items.
  if (p.items && c.items) {
    diffSchema(prevDoc, currDoc, p.items as Json, c.items as Json, `${path}[]`, breaks);
  }
}

// ── OpenAPI diff ──────────────────────────────────────────────────────────────

function diffOpenapi(prev: Json, curr: Json, mod: string): string[] {
  const breaks: string[] = [];
  const prevPaths = (prev.paths as Json | undefined) ?? {};
  const currPaths = (curr.paths as Json | undefined) ?? {};

  for (const pathKey of Object.keys(prevPaths)) {
    const prevPath = prevPaths[pathKey] as Json;
    const currPath = currPaths[pathKey] as Json | undefined;

    if (!currPath) {
      breaks.push(`s-${mod} OpenAPI '${pathKey}': endpoint removed`);
      continue;
    }

    for (const method of Object.keys(prevPath)) {
      if (method === "parameters") continue;
      const prevOp = prevPath[method] as Json;
      const currOp = currPath[method] as Json | undefined;

      if (!currOp) {
        breaks.push(`s-${mod} OpenAPI '${method.toUpperCase()} ${pathKey}': method removed`);
        continue;
      }

      // Response schemas — compare the 2xx shapes.
      const prevResp = (prevOp.responses as Json | undefined) ?? {};
      const currResp = (currOp.responses as Json | undefined) ?? {};
      for (const status of Object.keys(prevResp)) {
        if (!status.startsWith("2")) continue;
        const prevSchema = extractJsonSchema(prevResp[status] as Json);
        const currSchema = extractJsonSchema(currResp[status] as Json | undefined);
        if (prevSchema && currSchema) {
          diffSchema(
            prev,
            curr,
            prevSchema,
            currSchema,
            `s-${mod} OpenAPI '${method.toUpperCase()} ${pathKey}' response[${status}]`,
            breaks,
          );
        }
      }
    }
  }

  return breaks;
}

/**
 * Dig through `responses[<status>].content['application/json'].schema` → the
 * JSON Schema. Returns null if the path doesn't exist.
 */
function extractJsonSchema(responseNode: Json | undefined): Json | null {
  if (!responseNode) return null;
  const content = responseNode.content as Json | undefined;
  if (!content) return null;
  const json = content["application/json"] as Json | undefined;
  if (!json) return null;
  return (json.schema as Json) ?? null;
}

// ── AsyncAPI diff ─────────────────────────────────────────────────────────────

function diffAsyncapi(prev: Json, curr: Json, mod: string): string[] {
  const breaks: string[] = [];
  const prevCh = (prev.channels as Json | undefined) ?? {};
  const currCh = (curr.channels as Json | undefined) ?? {};

  for (const chKey of Object.keys(prevCh)) {
    const prevChNode = prevCh[chKey] as Json;
    const currChNode = currCh[chKey] as Json | undefined;

    if (!currChNode) {
      breaks.push(`s-${mod} AsyncAPI '${chKey}': event removed`);
      continue;
    }

    // Walk each message's payload.
    const prevMsgs = (prevChNode.messages as Json | undefined) ?? {};
    const currMsgs = (currChNode.messages as Json | undefined) ?? {};
    for (const msgKey of Object.keys(prevMsgs)) {
      const prevMsgRef = prevMsgs[msgKey] as Json;
      const currMsgRef = currMsgs[msgKey] as Json | undefined;
      if (!currMsgRef) {
        breaks.push(`s-${mod} AsyncAPI '${chKey}' message '${msgKey}': removed`);
        continue;
      }
      const prevMsg = deref(prev, prevMsgRef);
      const currMsg = deref(curr, currMsgRef);
      if (!prevMsg || !currMsg) continue;
      const prevPayload = prevMsg.payload as Json | undefined;
      const currPayload = currMsg.payload as Json | undefined;
      if (!prevPayload || !currPayload) continue;
      diffSchema(
        prev,
        curr,
        prevPayload,
        currPayload,
        `s-${mod} AsyncAPI '${chKey}' payload`,
        breaks,
      );
    }
  }

  return breaks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allBreaks: string[] = [];

  for (const mod of MODULES) {
    const openapiPath = `packages/s-${mod}/contracts/openapi.json`;
    const asyncapiPath = `packages/s-${mod}/contracts/events.asyncapi.json`;

    const [prevOpenapi, currOpenapi, prevAsync, currAsync] = await Promise.all([
      loadFromMain(openapiPath),
      loadFromPr(openapiPath),
      loadFromMain(asyncapiPath),
      loadFromPr(asyncapiPath),
    ]);

    if (prevOpenapi && currOpenapi) allBreaks.push(...diffOpenapi(prevOpenapi, currOpenapi, mod));
    if (prevAsync && currAsync) allBreaks.push(...diffAsyncapi(prevAsync, currAsync, mod));
  }

  if (allBreaks.length === 0) {
    console.log("✓ No breaking contract changes detected.");
    return;
  }

  const header = ALLOW_BREAKING
    ? "⚠ Breaking contract changes detected (allowed by 'breaking-api-change' label):"
    : "❌ Breaking contract changes detected:";
  console.error(header);
  for (const b of allBreaks) console.error(`  - ${b}`);

  if (!ALLOW_BREAKING) {
    console.error(
      "\nIf intentional, add the 'breaking-api-change' label to this PR and include a migration plan in the PR description.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
