import { Client } from "typesense";
import {
  type LoadConfigOptions,
  loadTypesenseConfig,
  loadTypesenseSearchOnlyConfig,
} from "./config";

/**
 * Client factories.
 *
 * Two separate instances intentionally:
 *   - admin client — full CRUD + schema ops, scoped to `<stage>_*`
 *   - search client — read-only `documents:search`, scoped to `<stage>_*`
 *
 * Each Lambda should only use the client it needs. The API route Lambda
 * calls `searchClient()`; the indexer Lambda + backfill script call
 * `adminClient()`. This keeps the blast radius of a leaked key minimal.
 *
 * Clients are cached per container — Typesense's Node SDK is thread-safe
 * for concurrent invocations within a single Lambda process.
 */

let adminCache: Client | undefined;
let searchCache: Client | undefined;

const CONNECTION_TIMEOUT_SECONDS = 5;
const HEALTHCHECK_INTERVAL_SECONDS = 30;
const RETRY_INTERVAL_SECONDS = 1;
const NUM_RETRIES = 3;

export async function adminClient(options: LoadConfigOptions = {}): Promise<Client> {
  if (adminCache && !options.ssm && !options.stage) return adminCache;

  const config = await loadTypesenseConfig(options);
  const client = new Client({
    nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
    apiKey: config.adminApiKey,
    connectionTimeoutSeconds: CONNECTION_TIMEOUT_SECONDS,
    healthcheckIntervalSeconds: HEALTHCHECK_INTERVAL_SECONDS,
    retryIntervalSeconds: RETRY_INTERVAL_SECONDS,
    numRetries: NUM_RETRIES,
  });

  if (!options.ssm && !options.stage) adminCache = client;
  return client;
}

export async function searchClient(options: LoadConfigOptions = {}): Promise<Client> {
  if (searchCache && !options.ssm && !options.stage) return searchCache;

  const config = await loadTypesenseSearchOnlyConfig(options);
  const client = new Client({
    nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
    apiKey: config.searchApiKey,
    connectionTimeoutSeconds: CONNECTION_TIMEOUT_SECONDS,
    healthcheckIntervalSeconds: HEALTHCHECK_INTERVAL_SECONDS,
    retryIntervalSeconds: RETRY_INTERVAL_SECONDS,
    numRetries: NUM_RETRIES,
  });

  if (!options.ssm && !options.stage) searchCache = client;
  return client;
}

/** Test helper — clears cached clients. */
export function __resetClientCacheForTests(): void {
  adminCache = undefined;
  searchCache = undefined;
}

/**
 * Test helper — inject fake clients. Lets integration tests swap the
 * Typesense client with a stub that returns canned responses, so the
 * Hono app + service layer can be exercised without a live cluster or
 * SSM round-trip.
 *
 * Pass `null` to restore the real lazy-loader path.
 */
export function __setClientsForTests(clients: {
  admin?: Client | null;
  search?: Client | null;
}): void {
  if (clients.admin !== undefined) adminCache = clients.admin ?? undefined;
  if (clients.search !== undefined) searchCache = clients.search ?? undefined;
}
