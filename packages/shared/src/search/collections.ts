/**
 * Stage-prefixed collection naming.
 *
 * Every stage (dev, test, pr-*, personal, prod) shares a single Typesense
 * cluster today. Logical isolation is enforced by:
 *   1. Collection names are always `<stage>_<entity>` — dev_users, prod_users, …
 *   2. Scoped API keys restrict each stage's keys to `<stage>_*` collections.
 *
 * This helper is the ONLY sanctioned way for module code to build a
 * collection name. Never hard-code a stage prefix anywhere else — when
 * a stage moves to its own cluster (expected for prod before GA), the
 * migration is a config flip, not a code change.
 */

const STAGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ENTITY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Resolve a stage-prefixed collection name for the current Lambda stage.
 *
 * @example
 *   process.env.STAGE = "dev"
 *   resolveCollectionName("users") // → "dev_users"
 *
 *   process.env.STAGE = "pr-42"
 *   resolveCollectionName("users") // → "pr-42_users"
 *
 * @throws if STAGE env var is missing or either input looks malformed.
 */
export function resolveCollectionName(entity: string, stage?: string): string {
  const resolvedStage = stage ?? process.env.STAGE;
  if (!resolvedStage) {
    throw new Error("STAGE env var not set — cannot build Typesense collection name");
  }
  if (!STAGE_PATTERN.test(resolvedStage)) {
    throw new Error(`Invalid stage name: ${resolvedStage}`);
  }
  if (!ENTITY_PATTERN.test(entity)) {
    throw new Error(`Invalid entity name: ${entity}`);
  }
  return `${resolvedStage}_${entity}`;
}
