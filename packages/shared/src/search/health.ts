import { searchClient } from "./client";
import type { LoadConfigOptions } from "./config";

export interface ProbeResult {
  status: "up" | "down";
  detail?: string;
}

/**
 * Typesense health probe used by `createApi()`'s `/info` endpoint.
 *
 * Fails gracefully — any error becomes `{ status: "down", detail }` so
 * /info never throws because search happens to be unreachable.
 */
export async function typesenseHealthProbe(options: LoadConfigOptions = {}): Promise<ProbeResult> {
  try {
    const client = await searchClient(options);
    const health = await client.health.retrieve();
    return health.ok ? { status: "up" } : { status: "down", detail: "health.ok was false" };
  } catch (err) {
    return {
      status: "down",
      detail: (err as Error).message,
    };
  }
}
