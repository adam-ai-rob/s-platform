/**
 * Structured JSON logger.
 *
 * Writes one JSON object per line to stdout. The Lambda runtime forwards
 * stdout to CloudWatch Logs, which parses JSON fields for querying via
 * CloudWatch Logs Insights.
 *
 * Emoji prefixes in messages are encouraged for visual scanning:
 *   🚀 startup, ✅ success, ❌ error, ⚠️ warning, 🔍 debug,
 *   🔒 auth, 📨 event-received, 📤 event-published.
 *
 * Never log secrets (passwords, tokens, JWTs, API keys, password hashes).
 */

type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR";

const SERVICE = process.env.SERVICE_NAME ?? "unknown";
const STAGE = process.env.STAGE ?? "dev";
const LOG_LEVEL: Severity = (process.env.LOG_LEVEL as Severity) ?? "INFO";

const SEVERITY_RANK: Record<Severity, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function shouldLog(severity: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[LOG_LEVEL];
}

function emit(severity: Severity, message: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(severity)) return;

  const entry = {
    severity,
    message,
    service: SERVICE,
    stage: STAGE,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("DEBUG", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("INFO", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("WARN", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("ERROR", message, fields),
};
