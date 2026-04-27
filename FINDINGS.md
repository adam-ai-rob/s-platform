# Code Review Findings

## Epic: Platform Systematic Review
Below are the findings grouped by priority (Bugs/Logic Errors, Security Vulnerabilities, Architectural and Design Violations).

### Priority 1: Bugs & Logic Errors

* **s-authn / Refresh Token Validation**
    * **Issue**: The refresh token flow (`packages/s-authn/core/src/auth/auth.service.ts` -> `refresh`) generates a new access token, but does not rotate the refresh token itself. It allows infinite reuse of a single refresh token until its original expiry. While not strictly a bug, without refresh token rotation, compromised refresh tokens can be used repeatedly. The current setup also lacks a single-use verification mechanism for refresh tokens.
    * **Task**: Implement Refresh Token Rotation (RTR).

* **s-authn / Error Mapping in Global Error Handler**
    * **Issue**: The `invalid_format` or similar HTTP errors explicitly built inside `packages/s-authn/functions/src/routes/auth.routes.ts` directly return `c.json({ error: ... })` bypassing the domain error abstractions. While they respond fine, this violates the layer boundaries where routes should parse inputs and call ONE service method, while error handling happens at the global error handler.

### Priority 2: Security Vulnerabilities

* **s-authn / User Enumerable Registration/Login**
    * **Issue**: The `POST /register` endpoint returns `409 Email already exists`. This is a classic user enumeration vulnerability. An attacker can probe the API to discover registered users' email addresses.
    * **Task**: Modify the register flow to return a generic success message, or handle it via a secure email confirmation flow (which is deferred to Phase 2). However, returning 409 exposes this information. The same is true for `POST /login` returning distinct errors for missing accounts versus incorrect passwords if not careful (the current implementation throws `InvalidCredentialsError` for both, which is good).

* **s-authz / Authz User Role Idempotency Bug / Missing Limits**
    * **Issue**: In `packages/s-authz/core/src/user-roles/user-roles.service.ts` inside `assignRoleToUser()`, when extending an existing assignment array `uniqueValues([...existingValues, ...addedValues])`, there's no cap on the number of elements inside `value`. A malicious user with `authz_admin` could assign a massive array causing DynamoDB item size limits (400KB) to be exceeded, breaking the role system for that user and causing DoS when they log in and `rebuildViewForUser` fails.
    * **Task**: Enforce a reasonable upper bound for array elements on `value`.

* **s-building / Admin Endpoint Scope Bypass (Potential)**
    * **Issue**: In `packages/s-building/functions/src/routes/admin.routes.ts`, non-superadmin users have their `filter_by` validated with `/[()|]/.test(filterBy)`. However, backtick escaping or string escaping might allow an attacker to inject logic if the `Typesense` query parser evaluates it maliciously. E.g. what if a `q` parameter is provided? The `q` param goes directly to Typesense.
    * **Task**: Verify Typesense filtering safety against injection.

### Priority 3: Architectural and Design Violations

* **Cross-Module Boundaries / Hardcoded Defaults in `auth/verify.ts`**
    * **Issue**: `packages/shared/src/auth/verify.ts` defaults to `s-platform` for audience and `s-authn` for issuer. These constants are hardcoded in the library, which breaks the separation of concerns if another module wants to reuse the shared library but has a different issuer.

* **s-authz / Inefficient Event Handlers**
    * **Issue**: Rebuilding the AuthzView for users inside `rebuildViewForUser` triggers multiple DynamoDB queries inside `resolvePermissionsForAssignments`. Specifically, iterating over assignments and running `authzRolesRepository.findById` inside a loop is an N+1 query problem. This could be slow and expensive.
    * **Task**: Batch get roles or cache role permissions since roles change infrequently.

* **Missing Pagination in AuthzUserRoles listByUser**
    * **Issue**: `authzUserRolesRepository.listByUser` fetches all records in a `do-while` loop until `nextToken` is empty. If a user is assigned many roles, this might time out the Lambda function. While users probably don't have thousands of roles, it's generally considered an anti-pattern.
    * **Task**: Add a hard limit or implement true pagination for internal list fetching.
