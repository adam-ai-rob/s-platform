/**
 * Shared helpers for module integration tests.
 *
 * All integration test files for a module MUST share one table name
 * (for example, `Buildings-test`, `UserProfiles-test`). Repository
 * singletons read `*_TABLE_NAME` at import time; files that use different
 * names can race under Bun's parallel test runner and fail with
 * `ResourceNotFoundException: Cannot do operations on a non-existent table`.
 * See `packages/s-building/tests/integration/*` for the pattern.
 */
export { startLocalDynamo, type LocalDynamo } from "./dynamodb-local";
export { createTable, deleteTableIfExists, type TableSchema } from "./table-factory";
export { createStubAuthzView, seedAuthzViewEntry } from "./authz-stub";
export { startJwtStub, type JwtStub, type SignOptions } from "./jwt-stub";
export { invoke, type InvokeOptions, type InvokeResult } from "./app-invoker";
export { createFakeTypesenseClient, type FakeTypesenseHandle } from "./fake-typesense";
