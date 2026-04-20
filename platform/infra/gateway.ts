/**
 * Platform API Gateway v2 — shared HTTP API fronting every module Lambda.
 *
 * Each module SST app registers its own `ANY /{module}/{proxy+}` route
 * against this gateway via `aws.apigatewayv2.Integration` + `Route`,
 * referencing the imported gateway id from SSM.
 *
 * CORS policy is a platform invariant:
 *   - `allowOrigins: ["*"]` (wildcard is required; auth is JWT bearer in
 *     Authorization header, not cookies, so `credentials: false` — CORS
 *     spec requires that when Origin is wildcard).
 *   - Do not change without coordinating with the team (root `CLAUDE.md`).
 *
 * When the stage has a custom domain (dev/test/prod), the gateway is
 * attached to it and an ACM cert + Route 53 A record are provisioned.
 */

import { getDomainConfig } from "./domains";

const domain = getDomainConfig();

export const gateway = new sst.aws.ApiGatewayV2("PlatformGateway", {
  cors: {
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
