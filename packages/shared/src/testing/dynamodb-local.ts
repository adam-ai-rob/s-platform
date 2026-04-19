import * as net from "node:net";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import DynamoDbLocal from "dynamodb-local";

/**
 * Launch a local DynamoDB instance on a random free port.
 *
 * Uses the `dynamodb-local` npm package, which downloads the official
 * DynamoDBLocal JAR on first run and spawns it with Java. Requires
 * Java 11+ on the host (pre-installed on GitHub Actions `ubuntu-latest`).
 *
 * Intended for integration tests only. Do not import from production code.
 */
export interface LocalDynamo {
  endpoint: string;
  port: number;
  stop(): Promise<void>;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("failed to allocate free port")));
      }
    });
  });
}

async function waitUntilReady(endpoint: string, timeoutMs = 20000): Promise<void> {
  const client = new DynamoDBClient({
    endpoint,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await client.send(new ListTablesCommand({}));
      client.destroy();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  client.destroy();
  throw new Error(
    `DynamoDB local at ${endpoint} not ready after ${timeoutMs}ms: ${String(lastErr)}`,
  );
}

export async function startLocalDynamo(): Promise<LocalDynamo> {
  const port = await findFreePort();
  // -inMemory avoids creating files on disk; -sharedDb keeps a single
  // namespace across regions so tests don't need to match AWS_REGION.
  await DynamoDbLocal.launch(port, null, ["-inMemory", "-sharedDb"]);
  const endpoint = `http://127.0.0.1:${port}`;
  await waitUntilReady(endpoint);
  return {
    endpoint,
    port,
    stop: async () => {
      DynamoDbLocal.stop(port);
    },
  };
}
