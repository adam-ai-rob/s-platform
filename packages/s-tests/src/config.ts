/**
 * Stage URL resolver.
 *
 * Returns the API base URL for a given stage. Prefer `STAGE` env var,
 * falls back to `dev`.
 *
 * Custom domains:
 *   dev   → https://dev.s-api.smartiqi.com
 *   test  → https://test.s-api.smartiqi.com
 *   prod  → https://s-api.smartiqi.com
 *
 * PR stages (pr-N) and personal stages don't have custom domains.
 * Set `API_URL` env var explicitly for those:
 *   API_URL=https://abc123.execute-api.eu-west-1.amazonaws.com \
 *   STAGE=pr-42 bun test
 */

export interface StageConfig {
  stage: string;
  apiUrl: string;
}

export function getStageConfig(): StageConfig {
  const stage = process.env.STAGE ?? "dev";
  const explicitUrl = process.env.API_URL;

  if (explicitUrl) {
    return { stage, apiUrl: explicitUrl };
  }

  switch (stage) {
    case "prod":
      return { stage, apiUrl: "https://s-api.smartiqi.com" };
    case "test":
      return { stage, apiUrl: "https://test.s-api.smartiqi.com" };
    case "dev":
      return { stage, apiUrl: "https://dev.s-api.smartiqi.com" };
    default:
      throw new Error(
        `No known API URL for stage=${stage}. Set API_URL env var to the default API Gateway URL.`,
      );
  }
}
