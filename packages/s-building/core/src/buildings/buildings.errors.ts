import { ConflictError, DomainError, NotFoundError, ValidationError } from "@s/shared/errors";

/**
 * Building domain errors.
 *
 * All extend shared `DomainError` subclasses so the global error
 * handler maps them to the right HTTP status automatically:
 *   NotFoundError  → 404
 *   ConflictError  → 409
 *   ValidationError → 400
 */

export class BuildingNotFoundError extends NotFoundError {
  constructor(buildingId: string) {
    super(`Building ${buildingId} not found`);
    Object.defineProperty(this, "details", {
      value: { buildingId },
      configurable: true,
    });
  }
}

// Thin alias of the shared ValidationError so callers can catch the
// module-specific class. ValidationError already maps to HTTP 400.
export { ValidationError as BuildingValidationError };

/**
 * Raised when an attempt to transition between lifecycle states is
 * illegal (e.g. `archived → draft`). Maps to HTTP 409 Conflict.
 */
export class BuildingStatusConflictError extends ConflictError {
  constructor(from: string, to: string) {
    super(`Illegal building status transition: ${from} → ${to}`);
    Object.defineProperty(this, "details", {
      value: { from, to },
      configurable: true,
    });
  }
}

// Re-export the common ones so service / route imports only need this file.
export { DomainError };
