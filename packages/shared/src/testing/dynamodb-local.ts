import * as net from "node:net";
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

export async function startLocalDynamo(): Promise<LocalDynamo> {
  const port = await findFreePort();
  // -inMemory avoids creating files on disk; -sharedDb keeps a single
  // namespace across regions so tests don't need to match AWS_REGION.
  await DynamoDbLocal.launch(port, null, ["-inMemory", "-sharedDb"]);
  return {
    endpoint: `http://127.0.0.1:${port}`,
    port,
    stop: async () => {
      DynamoDbLocal.stop(port);
    },
  };
}
