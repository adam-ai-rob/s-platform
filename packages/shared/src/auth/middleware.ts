import type { MiddlewareHandler } from "hono";
import { ForbiddenError, UnauthorizedError } from "../errors/domain-error";
import { logger } from "../logger/logger";
import type { UserContext } from "../types/index";
import { getCached, hashToken, setCached } from "./cache";
import { verifyAccessToken } from "./verify";

/**
 * Auth middleware for Hono.
 *
 * For protected routes that are NOT behind a Lambda authorizer (the
 * authorizer handles this at the gateway layer for most routes).
 *
 * Currently used by `/info` which needs full Hono context.
 *
 * Flow:
 *   1. Extract Bearer token from Authorization header
 *   2. Hash token → check cache
 *   3. On miss: verify JWT → build UserContext → cache
 *   4. Set c.get("user") for downstream handlers
 *
 * NOTE: permissions come from authz_view in the full implementation.
 * For now, this middleware sets permissions: [] from the token payload.
 * Wire up the authz_view lookup once s-authz is deployed.
 */

export type AuthEnv = {
  Variables: {
    user: UserContext;
    traceId?: string;
  };
};

export function authMiddleware(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing Bearer token");
    }

    const token = authHeader.slice(7);
    const tokenHash = hashToken(token);

    const cached = getCached(tokenHash);
    if (cached) {
      c.set("user", cached);
      await next();
      return;
    }

    const payload = await verifyAccessToken(token);

    // TODO: once s-authz is deployed, load permissions from authz_view:
    //   const view = await AuthzViewRepository.get(payload.sub);
    //   const permissions = view?.permissions ?? [];
    const permissions: UserContext["permissions"] = [];

    const context: UserContext = {
      userId: payload.sub,
      permissions,
      ...(payload.system === true ? { system: true } : {}),
    };

    setCached(tokenHash, context);
    c.set("user", context);

    await next();
  };
}

/**
 * Require a permission. Returns 403 if the user doesn't have it.
 */
export function requirePermission(permissionId: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw new UnauthorizedError("User context missing");

    const has = user.permissions.some((p) => p.id === permissionId);
    if (!has && user.system !== true) {
      logger.info("🔒 Access denied", {
        userId: user.userId,
        requiredPermission: permissionId,
      });
      throw new ForbiddenError(`Missing permission: ${permissionId}`);
    }

    await next();
  };
}

/**
 * Allow self-access OR require a permission.
 *
 * Used for routes where a user can manage their own resource, or admins
 * can manage anyone's.
 *
 * `extractUserId` receives the Hono context and returns the resource owner
 * ID to compare against the current user.
 */
export function requireSelfOrPermission(
  permissionId: string,
  extractUserId: (c: Parameters<MiddlewareHandler<AuthEnv>>[0]) => string,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw new UnauthorizedError("User context missing");

    const targetUserId = extractUserId(c);
    const isSelf = targetUserId === user.userId;
    const hasPermission = user.permissions.some((p) => p.id === permissionId);

    if (!isSelf && !hasPermission && user.system !== true) {
      throw new ForbiddenError(`Must be self or have permission: ${permissionId}`);
    }

    await next();
  };
}

/**
 * Require the token was issued for a system call (service-to-service).
 */
export function requireSystem(): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user || user.system !== true) {
      throw new ForbiddenError("System-level call required");
    }
    await next();
  };
}
