import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "../ddb/client";
import { logger } from "../logger/logger";
import type { Permission } from "../types/index";

/**
 * AuthzView lookup for auth middleware.
 *
 * Every API Lambda is linked to the `AuthzView` table (owned by s-authz)
 * via SST, and receives `AUTHZ_VIEW_TABLE_NAME` as an env var. This
 * module reads the current user's permissions from that table.
 *
 * Not found ⇒ empty list (deny-by-default). This happens for users who
 * haven't been through the `user.registered` event flow yet.
 */

export async function fetchPermissions(userId: string): Promise<Permission[]> {
  const table = process.env.AUTHZ_VIEW_TABLE_NAME;
  if (!table) {
    logger.warn("⚠️ AUTHZ_VIEW_TABLE_NAME not set — auth middleware running without permissions", {
      userId,
    });
    return [];
  }

  try {
    const res = await getDdbClient().send(
      new GetCommand({
        TableName: table,
        Key: { userId },
      }),
    );

    const entry = res.Item as { permissions?: Permission[] } | undefined;
    return entry?.permissions ?? [];
  } catch (err) {
    // Fail closed — log and return empty. The request hits requirePermission
    // middleware next, which will 403 anything permission-gated.
    logger.error("❌ AuthzView fetch failed", {
      errorCode: "AUTHZ_VIEW_FETCH_FAILED",
      userId,
      message: (err as Error).message,
    });
    return [];
  }
}
