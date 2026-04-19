import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDdbClient } from "../ddb/client";
import type { Permission } from "../types/index";
import { createTable } from "./table-factory";

/**
 * Stub "AuthzView" table owner for module integration tests. Matches the
 * shape that `packages/shared/src/auth/view-lookup.ts` reads: partition
 * key `userId`, optional `permissions: Permission[]` attribute.
 *
 * Use this when testing any module whose auth middleware depends on
 * AuthzView without deploying s-authz.
 */
export async function createStubAuthzView(endpoint: string, tableName: string): Promise<void> {
  await createTable(endpoint, {
    tableName,
    partitionKey: "userId",
  });
}

export async function seedAuthzViewEntry(
  tableName: string,
  userId: string,
  permissions: Permission[],
): Promise<void> {
  await getDdbClient().send(
    new PutCommand({
      TableName: tableName,
      Item: { userId, permissions },
    }),
  );
}
