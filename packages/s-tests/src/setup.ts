import { getStageConfig } from "./config";

/**
 * Shared test setup.
 *
 * Prints the target stage on test run start so CI logs make it obvious
 * which environment was tested.
 */

const { stage, apiUrl } = getStageConfig();

console.log(`\n🧪 Running e2e tests against stage=${stage}  url=${apiUrl}\n`);
