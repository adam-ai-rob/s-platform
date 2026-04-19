# Logging, Tracing, and Monitoring

The most important operational guide. When something breaks in production, this document tells you how to find the problem.

## Structured Logging

All Lambdas log JSON objects to stdout. The Lambda runtime forwards stdout to CloudWatch Logs, which indexes JSON fields automatically for querying via CloudWatch Logs Insights.

### Required Fields

Every log entry includes:

```typescript
{
  severity: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,           // human-readable, searchable
  service: string,           // "s-authn", "s-user", etc.
  stage: string,             // "dev", "test", "prod", "pr-42"
  traceId: string,           // from W3C traceparent
  timestamp: string,         // ISO 8601
}
```

### Optional Fields

Include when relevant:

| Field | Type | When to include |
|---|---|---|
| `userId` | string | Any operation tied to a specific user |
| `durationMs` | number | Performance-sensitive operations (DB, external calls) |
| `errorCode` | string | Error entries (makes errors searchable by code) |
| `email` | string | Auth operations (careful with PII) |
| `action` | string | Audit events |
| `eventName` | string | Event publishing/handling |
| `correlationId` | string | Event processing |
| `method` | string | HTTP method for request logs |
| `path` | string | Request path |
| `statusCode` | number | Response status |
| `requestId` | string | AWS Lambda request ID |
| `coldStart` | boolean | First invocation of a Lambda container |

### The Logger Utility

```typescript
// packages/shared/src/logger/index.ts
const SERVICE = process.env.SERVICE_NAME ?? "unknown";
const STAGE = process.env.STAGE ?? "dev";

type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR";

function log(severity: Severity, message: string, fields?: Record<string, unknown>): void {
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
  debug: (msg: string, f?: Record<string, unknown>) => log("DEBUG", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => log("INFO", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => log("WARN", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => log("ERROR", msg, f),
};
```

### Emoji Prefixes

Use emoji prefixes in messages for fast visual scanning in CloudWatch:

| Emoji | Use |
|---|---|
| 🚀 | Service startup, cold start |
| ✅ | Success after operation |
| ❌ | Error |
| ⚠️ | Warning / recoverable problem |
| 🔍 | Debug / detailed flow |
| 🔒 | Auth / permission check |
| 📨 | Event received |
| 📤 | Event published |
| 📧 | Email sent |
| ⏱️ | Performance measurement |

Example: `logger.info("✅ User registered", { userId, email, traceId })`

## When to Log What

| Severity | When | Examples |
|---|---|---|
| **DEBUG** | Unhandled event types, cache hits, detailed flow | `"🔍 Token cache hit"`, `"Unhandled event: foo.bar (ignored)"` |
| **INFO** | Successful operations, state changes | `"✅ User profile created"`, `"📤 Event published"` |
| **WARN** | Recoverable errors, degraded state | `"⚠️ Rate limit at 80%"`, `"⚠️ Event publish failed, will retry"` |
| **ERROR** | Unhandled errors, failed ops affecting user | `"❌ Unhandled error in POST /user"` + stack |

**DEBUG is ON in dev/test, OFF in prod.** Controlled via `LOG_LEVEL` env var.

## What NOT to Log

- **Passwords, tokens, JWTs, API keys, password hashes** — never under any severity
- **Full PII in ERROR logs** — redact email domains or hash if needed for error context
- **Request/response bodies in prod** — DEBUG-only if needed at all
- **Successful health checks** — uptime checks fire every minute; don't log them
- **Every cache hit** — DEBUG with sampling, if at all

## Good Logging Patterns

### Include context that helps debugging

```typescript
logger.info("✅ User registered", {
  userId: user.id,
  email: user.email,
  traceId,
});
```

### Log errors with searchable codes

```typescript
logger.error("❌ Unhandled error", {
  errorCode: "INTERNAL_ERROR",
  message: err.message,
  stack: err.stack,
  traceId,
  userId,
  method: c.req.method,
  path: c.req.path,
});
```

### Log audit events (for security review)

```typescript
logger.info("🔒 login", {
  action: "login",
  success: true,
  userId,
  ipAddress: c.req.header("x-forwarded-for"),
  userAgent: c.req.header("user-agent"),
  traceId,
});
```

### Log state transitions

```typescript
logger.info("🔒 User disabled", {
  userId,
  disabledBy: adminUserId,
  reason,
  traceId,
});
```

### Measure durations

```typescript
const start = Date.now();
const result = await slowOperation();
logger.info("⏱️ Operation complete", {
  operation: "authz-view-rebuild",
  userId,
  durationMs: Date.now() - start,
});
```

## Bad Logging Patterns

### Sensitive data

```typescript
// NEVER
logger.info("Login attempt", { email, password: params.password });
logger.debug("Token issued", { token: jwt });
```

### Noise

```typescript
// Too noisy — every request, no useful info
logger.info("Request received");
logger.info("Request completed");

// Health checks create thousands of entries per day
logger.info("Health check OK");
```

### String concatenation

```typescript
// BAD — unstructured, hard to search
logger.info(`User ${userId} logged in from ${ip}`);

// GOOD
logger.info("🔒 login", { userId, ip });
```

## Distributed Tracing

### W3C traceparent

All modules propagate the W3C `traceparent` header:

```
traceparent: 00-<trace-id>-<span-id>-01
```

The `traceMiddleware()` from `@s/shared/trace` extracts or generates trace context:

```typescript
// packages/shared/src/trace/middleware.ts
export function traceMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const traceparent = c.req.header("traceparent");
    let traceId: string;
    let spanId: string;

    if (traceparent) {
      const parts = traceparent.split("-");
      traceId = parts[1];
      spanId = generateSpanId();
    } else {
      traceId = generateTraceId();
      spanId = generateSpanId();
    }

    c.set("traceId", traceId);
    c.set("spanId", spanId);
    c.set("traceparent", `00-${traceId}-${spanId}-01`);

    await next();
  };
}
```

### AWS X-Ray

All Lambdas have X-Ray active tracing enabled:

```typescript
// infra/s-authn.ts
export const authnApi = new sst.aws.Function("AuthnApi", {
  handler: "packages/s-authn/functions/src/api.handler",
  tracing: "active",  // enables X-Ray
});
```

X-Ray automatically traces:

- Lambda invocations
- DynamoDB calls
- EventBridge PutEvents
- KMS operations
- HTTP calls (if instrumented via `@aws-sdk/*`)

The X-Ray trace ID is set from the `traceparent` for consistency across logs, traces, and events.

### Tracing a Request End-to-End

1. Find any log entry from the request (e.g., an error).
2. Copy the `traceId`.
3. In CloudWatch Logs Insights, query across all log groups:
   ```
   fields @timestamp, service, message, severity
   | filter traceId = "abc123..."
   | sort @timestamp asc
   ```
4. All log entries from all modules for that request appear in order.
5. Open X-Ray console → search by trace ID → see the full distributed trace.

## Monitoring

### Uptime Checks

Every module exposes `GET /health` — public, no dependencies, < 10ms response.

CloudWatch Synthetics canary (or Route 53 health check) runs every minute against each module's health endpoint:

- Trigger alarm after 2 consecutive failures
- Notification: SNS topic → email + Slack

```typescript
// infra/shared.ts
const healthCanary = new aws.synthetics.Canary(`HealthCanary`, {
  name: `${$app.stage}-platform-health`,
  runtimeVersion: "syn-nodejs-puppeteer-6.2",
  schedule: { expression: "rate(1 minute)" },
  startCanary: true,
  code: { handler: "index.handler", /* canary script */ },
});
```

### Error Rate Alerts

Per-module CloudWatch alarm:

- **Metric:** 5xx count / total requests from API Gateway access logs
- **Threshold:** > 1% for 5 consecutive minutes
- **Action:** SNS → email + Slack

### Lambda Function Alarms

- **Errors:** CloudWatch Lambda `Errors` metric > 5 per minute
- **Duration:** p99 > timeout × 0.8
- **Throttles:** `Throttles` metric > 0
- **DLQ messages:** `ApproximateNumberOfMessagesVisible` > 0 on any DLQ

### Custom Metrics

Emit custom metrics via embedded metric format (EMF):

```typescript
// Emits CloudWatch metric via structured log
console.log(JSON.stringify({
  _aws: {
    Timestamp: Date.now(),
    CloudWatchMetrics: [{
      Namespace: "s-platform",
      Dimensions: [["Service", "Stage"]],
      Metrics: [{ Name: "AuthzViewRebuildDuration", Unit: "Milliseconds" }],
    }],
  },
  Service: "s-authz",
  Stage: $app.stage,
  AuthzViewRebuildDuration: durationMs,
}));
```

CloudWatch parses the embedded format and emits a real metric. No PutMetricData API call needed.

Standard metrics to emit:

| Metric | Unit | When |
|---|---|---|
| `EventPublishDuration` | Milliseconds | After EventBridge PutEvents |
| `EventHandlerDuration` | Milliseconds | In event handler |
| `AuthzViewRebuildDuration` | Milliseconds | After authz-view rebuild |
| `AuthCacheHitRate` | Count | On each auth check (hit=1 / miss=0) |

### Dashboards

One CloudWatch dashboard per stage with:

- Request rate per module (sum of API Gateway requests, by Lambda name)
- Error rate per module (4xx + 5xx)
- Latency p50/p95/p99 per module
- Lambda cold start count
- DynamoDB read/write capacity consumption
- EventBridge rule match count
- DLQ message count

Defined in `infra/dashboards.ts` (to be added per stage).

## CloudWatch Logs Insights Queries

### All errors across the platform

```
fields @timestamp, service, message, errorCode, traceId
| filter severity = "ERROR"
| sort @timestamp desc
| limit 100
```

### Errors for a specific service

```
fields @timestamp, message, errorCode, userId, traceId
| filter service = "s-authn" and severity = "ERROR"
| sort @timestamp desc
```

### Trace a specific request across all services

Run the query against multiple log groups (`/aws/lambda/*`):

```
fields @timestamp, service, message, severity
| filter traceId = "abc123..."
| sort @timestamp asc
```

### Authentication failures in the last hour

```
fields @timestamp, email, errorCode
| filter service = "s-authn" and errorCode in ["INVALID_CREDENTIALS", "USER_DISABLED"]
| sort @timestamp desc
```

### Slow requests (p99 tail)

```
fields @timestamp, path, durationMs, userId
| filter durationMs > 2000
| sort durationMs desc
```

### All events published by a service

```
fields @timestamp, eventName, correlationId, userId
| filter service = "s-authn" and message like /📤/
| sort @timestamp desc
```

### Failed event handling

```
fields @timestamp, eventName, correlationId, errorMessage
| filter message like /Event handler failed/
| sort @timestamp desc
```

### Specific user's activity

```
fields @timestamp, service, message, action
| filter userId = "01HXYZ..."
| sort @timestamp desc
```

### Lambda cold starts

```
fields @timestamp, service
| filter coldStart = true
| stats count() by service, bin(5m)
```

## Log Retention

| Stage | Retention |
|---|---|
| dev | 7 days |
| test | 14 days |
| prod | 90 days |
| pr-* | 3 days |

Configured via `sst.aws.Function` `logging.retention` option per stage.

## Access Control

- CloudWatch read-only access granted to all engineers via SSO
- Log data sensitivity: treat as confidential (may contain user IDs, IPs)
- Do not export log snippets to public issue trackers without redaction

## Operational Playbook

When an error alarm fires:

1. Open CloudWatch alarm → click "View in Logs Insights"
2. Identify affected trace IDs from the alarm period
3. Run the trace-across-services query for each trace ID
4. Check X-Ray for the full distributed trace
5. Root cause in logs → fix in code → deploy to dev → verify → promote

When event processing stalls:

1. Check DLQ message count per consumer
2. Check SQS queue depth (if SQS buffering)
3. Check Lambda throttles
4. Check downstream dependencies (DynamoDB throttling, KMS throttling)
5. For persistent failures: inspect DLQ messages, fix handler, redrive
