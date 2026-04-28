/**
 * Read a positive-integer rate-limit cap from env, falling back to the
 * platform default. Defaults match the prod-safe values; deployed-test
 * stages override via env so the journey suite doesn't exhaust the
 * per-IP quota (see #129).
 */
export function envLimit(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}
