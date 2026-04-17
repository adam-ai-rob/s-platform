import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { UnauthorizedError } from "../errors/domain-error";

/**
 * JWT verification helper.
 *
 * Uses `jose.createRemoteJWKSet` which caches the JWKS for 1 hour and
 * handles KID rotation automatically.
 *
 * Configure via env vars:
 *   AUTHN_URL — base URL of s-authn, e.g. https://s-api.smartiqi.com
 *               (JWKS is fetched from ${AUTHN_URL}/authn/auth/jwks)
 *   JWT_ISSUER — expected `iss` claim (default: "s-authn")
 *   JWT_AUDIENCE — expected `aud` claim (default: "s-platform")
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const authnUrl = process.env["AUTHN_URL"];
    if (!authnUrl) {
      throw new Error("AUTHN_URL env var not set — required for JWT verification");
    }
    jwks = createRemoteJWKSet(new URL(`${authnUrl}/authn/auth/jwks`));
  }
  return jwks;
}

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  system?: boolean;
}

/**
 * Verify a JWT access token. Throws UnauthorizedError on any failure.
 *
 * Returns the decoded payload on success.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: process.env["JWT_ISSUER"] ?? "s-authn",
      audience: process.env["JWT_AUDIENCE"] ?? "s-platform",
    });

    if (!payload.sub) {
      throw new UnauthorizedError("Token missing sub claim");
    }

    return payload as AccessTokenPayload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError(
      err instanceof Error ? err.message : "Token verification failed",
    );
  }
}
