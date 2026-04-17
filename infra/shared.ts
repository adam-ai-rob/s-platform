/**
 * Shared infrastructure across all modules.
 *
 * - PlatformGateway — single API Gateway v2 (HTTP API) fronting all module Lambdas
 * - PlatformEventBus — custom EventBridge bus for cross-module events
 * - JwtSigningKey — KMS RSA-4096 key used by s-authn to sign JWTs
 * - (Custom domain when stage has one)
 *
 * Each per-module infra file (`infra/s-{module}.ts`) imports these
 * resources and attaches routes, rules, and IAM policies.
 */

import * as aws from "@pulumi/aws";
import { getDomainConfig } from "./domains";

// ─── KMS: JWT Signing Key (RSA-4096) ──────────────────────────────────────────

export const jwtSigningKey = new aws.kms.Key("JwtSigningKey", {
  description: `s-authn JWT signing key (${$app.stage})`,
  keyUsage: "SIGN_VERIFY",
  customerMasterKeySpec: "RSA_4096",
  deletionWindowInDays: $app.stage === "prod" ? 30 : 7,
  enableKeyRotation: false, // RSA signing keys don't auto-rotate
});

export const jwtSigningKeyAlias = new aws.kms.Alias("JwtSigningKeyAlias", {
  name: `alias/s-authn-jwt-${$app.stage}`,
  targetKeyId: jwtSigningKey.keyId,
});

// ─── EventBridge: Platform Event Bus ──────────────────────────────────────────

export const platformEventBus = new sst.aws.Bus("PlatformEventBus", {
  // Custom bus name per stage
  // Modules subscribe via EventBridge rules in their own stack files
});

// Optional: archive for replay (90 days)
new aws.cloudwatch.EventArchive("PlatformEventArchive", {
  name: `platform-events-archive-${$app.stage}`,
  eventSourceArn: platformEventBus.arn,
  retentionDays: 90,
  description: "Archive for replay of platform events",
});

// ─── API Gateway: Shared HTTP API ─────────────────────────────────────────────

const domain = getDomainConfig();

export const gateway = new sst.aws.ApiGatewayV2("PlatformGateway", {
  cors: {
    // Wildcard origin is intentional. Auth is JWT bearer in Authorization header,
    // not cookies. `credentials: false` (implicit) is required for wildcard.
    // Do not change without coordinating with the team.
    allowOrigins: ["*"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Traceparent", "X-Location"],
  },
  ...(domain && {
    domain: {
      name: domain.apiDomain,
      // sst.aws.dns() with no args auto-resolves the hosted zone by
      // suffix-matching the domain name. `s-api.smartiqi.com` is the
      // closest zone match for dev/test/prod.s-api.smartiqi.com and
      // the apex. Passing an explicit zoneId/zoneName caused "no
      // matching zone found" in SST's internal getZone invocation.
      dns: sst.aws.dns(),
    },
  }),
});

// Public /health (catch-all across modules — each module's Lambda provides its own)
// NOTE: individual modules add their own `GET /{module}/health` via routes in their stack.
// A platform-level /health is optional; omit for now to keep routing clean.

// OPTIONS /{proxy+} — CORS preflight for all routes, no auth
// gateway-level CORS handles this, but keeping as explicit route is a belt-and-suspenders choice.
