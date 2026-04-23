import { seedSystemRoles } from "@s-authz/core/seeds/system-roles";
import { logger } from "@s/shared/logger";

/**
 * Seed Lambda — idempotently creates the s-authz system roles on a
 * stage. Invoked manually from the bootstrap runbook; no event trigger.
 *
 * Invocation contract:
 *   (no input)
 *
 * Returns:
 *   {
 *     "created": ["building-superadmin", ...],
 *     "skipped": ["already-existing-role", ...]
 *   }
 *
 * See [`docs/runbooks/fresh-stage-bootstrap.md`](../../../../docs/runbooks/fresh-stage-bootstrap.md)
 * for the operator flow.
 */
export async function handler(): Promise<{ created: string[]; skipped: string[] }> {
  logger.info("🌱 s-authz seed Lambda invoked");
  const result = await seedSystemRoles();
  logger.info("🌱 seed Lambda finished", result);
  return result;
}
