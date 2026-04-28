/**
 * Read a positive-integer rate-limit cap from env, falling back to the
 * platform default. Defaults match the prod-safe values; deployed-test
 * stages override via env so the journey suite doesn't exhaust the
 * per-IP quota (see #129).
 */
// Positive integer with no leading zero, no decimal, no exponent, no
// trailing junk. Number.parseInt would silently accept "10abc" → 10 and
// "1.5" → 1, which for rate-limit config is worse than failing fast.
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export function envLimit(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  if (!POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return Number.parseInt(raw, 10);
}
