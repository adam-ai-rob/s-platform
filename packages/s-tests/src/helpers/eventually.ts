/**
 * Retry an assertion until it passes or the timeout elapses.
 *
 * Use for eventually-consistent checks after events have been published
 * — e.g. "profile was created after register event".
 *
 *   await eventually(async () => {
 *     const r = await client.user.getProfile(userId);
 *     expect(r.data.email).toBe(email);
 *   }, { timeout: 10_000 });
 */

export interface EventuallyOptions {
  timeout?: number; // total ms
  interval?: number; // ms between attempts
}

export async function eventually(
  assertion: () => Promise<void>,
  options: EventuallyOptions = {},
): Promise<void> {
  const timeout = options.timeout ?? 10_000;
  const interval = options.interval ?? 500;
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  throw lastError ?? new Error("eventually: timed out with no error captured");
}
