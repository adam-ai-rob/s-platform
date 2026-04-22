import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { logger } from "../logger/logger";

/**
 * Runtime Typesense configuration for the current stage.
 *
 * Resolved from SSM at first use and cached for the lifetime of the
 * Lambda container. Every stage has its own SSM keys, even when multiple
 * stages currently share a single Typesense cluster — the shared-cluster
 * decision is an SSM-value concern, not a code concern (see ADR).
 */
export interface TypesenseConfig {
  host: string;
  port: number;
  protocol: "http" | "https";
  /** Admin key — scoped to `<stage>_*` collections. Used by indexer + backfill. */
  adminApiKey: string;
  /** Read-only search key — scoped to `<stage>_*` collections. Used by search route. */
  searchApiKey: string;
}

/** Keys used when the admin key is not needed (e.g. search-only runtime). */
export type TypesenseSearchOnlyConfig = Omit<TypesenseConfig, "adminApiKey">;

const DEFAULT_PORT = 443;
const DEFAULT_PROTOCOL = "https" as const;

export interface LoadConfigOptions {
  /** Override SSM client (tests). */
  ssm?: Pick<SSMClient, "send">;
  /** Override stage (tests); defaults to `process.env.STAGE`. */
  stage?: string;
  /** Skip admin key (search-only workers). */
  searchOnly?: boolean;
}

let cached: TypesenseConfig | undefined;
let cachedSearchOnly: TypesenseSearchOnlyConfig | undefined;

function ssmPath(stage: string, key: string): string {
  return `/s-platform/${stage}/typesense/${key}`;
}

async function getParam(
  client: Pick<SSMClient, "send">,
  name: string,
  withDecryption: boolean,
): Promise<string> {
  const res = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: withDecryption }),
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${name} is missing or empty`);
  }
  return value;
}

/**
 * Load Typesense config from SSM. Results are cached per Lambda container.
 *
 * - Host comes from a plain String parameter.
 * - Admin + search keys are SecureString parameters (KMS-encrypted).
 * - Port and protocol are currently hard-coded to 443/https (Typesense Cloud
 *   managed endpoint); relax if we ever self-host.
 */
export async function loadTypesenseConfig(
  options: LoadConfigOptions = {},
): Promise<TypesenseConfig> {
  if (cached && !options.ssm && !options.stage) return cached;

  const stage = options.stage ?? process.env.STAGE;
  if (!stage) {
    throw new Error("STAGE env var not set — cannot resolve Typesense SSM path");
  }

  const ssm = options.ssm ?? new SSMClient({ region: process.env.AWS_REGION ?? "eu-west-1" });

  const [host, adminApiKey, searchApiKey] = await Promise.all([
    getParam(ssm, ssmPath(stage, "host"), false),
    getParam(ssm, ssmPath(stage, "api-key-admin"), true),
    getParam(ssm, ssmPath(stage, "api-key-search"), true),
  ]);

  const config: TypesenseConfig = {
    host,
    port: DEFAULT_PORT,
    protocol: DEFAULT_PROTOCOL,
    adminApiKey,
    searchApiKey,
  };

  logger.debug("Loaded Typesense config from SSM", { stage, host });

  if (!options.ssm && !options.stage) cached = config;
  return config;
}

export async function loadTypesenseSearchOnlyConfig(
  options: Omit<LoadConfigOptions, "searchOnly"> = {},
): Promise<TypesenseSearchOnlyConfig> {
  if (cachedSearchOnly && !options.ssm && !options.stage) return cachedSearchOnly;

  const stage = options.stage ?? process.env.STAGE;
  if (!stage) {
    throw new Error("STAGE env var not set — cannot resolve Typesense SSM path");
  }

  const ssm = options.ssm ?? new SSMClient({ region: process.env.AWS_REGION ?? "eu-west-1" });

  const [host, searchApiKey] = await Promise.all([
    getParam(ssm, ssmPath(stage, "host"), false),
    getParam(ssm, ssmPath(stage, "api-key-search"), true),
  ]);

  const config: TypesenseSearchOnlyConfig = {
    host,
    port: DEFAULT_PORT,
    protocol: DEFAULT_PROTOCOL,
    searchApiKey,
  };

  if (!options.ssm && !options.stage) cachedSearchOnly = config;
  return config;
}

/** Test helper — clears the module-level cache. */
export function __resetConfigCacheForTests(): void {
  cached = undefined;
  cachedSearchOnly = undefined;
}
