/**
 * Custom-domain configuration per stage.
 *
 * Returns `undefined` for stages without a custom domain (PR stages,
 * personal dev stages, and `phase3-*` scratch stages) — SST falls back
 * to the default API Gateway URL.
 *
 * DNS delegation: `s-api.smartiqi.com` is a delegated hosted zone in the
 * itinn-bot account (058264437321). NS records pointing to it live in the
 * parent `smartiqi.com` zone in the common account (679821015569).
 *
 * See ../../docs/setup/02-cross-account-dns.md for delegation setup.
 *
 * `sst.aws.dns()` resolves the hosted zone by suffix-matching the
 * requested domain, so we don't need to pass the zone ID explicitly.
 *
 * This is a verbatim copy of the root `infra/domains.ts`. Both will
 * coexist during the Phase 3 migration; the root copy is deleted in the
 * final cut-over PR.
 */

export interface DomainConfig {
  apiDomain: string;
}

export function getDomainConfig(): DomainConfig | undefined {
  const stage = $app.stage;

  if (stage === "prod") {
    return { apiDomain: "s-api.smartiqi.com" };
  }
  if (stage === "test") {
    return { apiDomain: "test.s-api.smartiqi.com" };
  }
  if (stage === "dev") {
    return { apiDomain: "dev.s-api.smartiqi.com" };
  }

  // pr-{N}, personal dev stages, phase3 scratch stages — no custom domain
  return undefined;
}
