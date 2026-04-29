import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Journey-test authz seeder.
 *
 * Writes directly to the `AuthzView` DynamoDB table — the same
 * materialized view that `@s/shared/auth/view-lookup` reads on every
 * authenticated request. Bypasses s-authz's admin API because:
 *
 *   1. No authz_admin user exists in dev by default; creating one
 *      requires writing to the same `AuthzView` anyway.
 *   2. `AuthzView` is the source of truth for auth middleware. Writing
 *      there directly is closer to the real thing than any rebuild
 *      path a mock would take.
 *
 * The seeder resolves the stage-specific table name from the same SSM
 * parameter every module Lambda reads (`authz-view-table-name`), so it
 * works on any stage without extra configuration.
 *
 * CI runners have `GitHubActionsRole` which includes broad DDB + SSM
 * permissions (it already deploys these tables via SST). Local runs
 * need whatever AWS profile resolves for the chosen region.
 */

interface Permission {
  id: string;
  value?: unknown[];
}

const region = process.env.AWS_REGION ?? "eu-west-1";
const ssm = new SSMClient({ region });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

let cachedTableName: string | undefined;

async function authzViewTableName(): Promise<string> {
  if (cachedTableName) return cachedTableName;
  const stage = process.env.STAGE ?? "dev";
  const res = await ssm.send(
    new GetParameterCommand({ Name: `/s-platform/${stage}/authz-view-table-name` }),
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(
      `SSM /s-platform/${stage}/authz-view-table-name not found — has s-authz been deployed to this stage?`,
    );
  }
  cachedTableName = value;
  return value;
}

// s-authz subscribes to `user.registered` and asynchronously calls
// `initViewForUser` → writes `{ userId, permissions: [] }` to AuthzView.
// If we seed before the handler runs, the handler will overwrite our
// permissions with empty. So poll until the handler-created entry appears,
// then put the seed on top. The handler doesn't fire a second time, so
// the seeded value sticks. (Issue #132.)
const SEED_WAIT_TIMEOUT_MS = 30_000;
const SEED_WAIT_INTERVAL_MS = 500;

export async function seedAuthzPermissions(
  userId: string,
  permissions: Permission[],
): Promise<void> {
  const tableName = await authzViewTableName();

  const deadline = Date.now() + SEED_WAIT_TIMEOUT_MS;
  let initialized = false;
  while (Date.now() < deadline) {
    const res = await ddb.send(new GetCommand({ TableName: tableName, Key: { userId } }));
    if (res.Item) {
      initialized = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, SEED_WAIT_INTERVAL_MS));
  }
  if (!initialized) {
    throw new Error(
      `seedAuthzPermissions: AuthzView entry for ${userId} did not appear within ${SEED_WAIT_TIMEOUT_MS}ms — has the s-authz user.registered handler stalled?`,
    );
  }

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: { userId, permissions },
    }),
  );
}

export async function clearAuthzPermissions(userId: string): Promise<void> {
  const tableName = await authzViewTableName();
  await ddb.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { userId },
    }),
  );
}
