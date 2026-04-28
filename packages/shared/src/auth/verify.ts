import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import { UnauthorizedError } from "../errors/domain-error";

/**
 * JWT verification helper.
 *
 * Uses `jose.createRemoteJWKSet` which caches the JWKS for 1 hour and
 * handles KID rotation automatically.
 *
 * Required env vars (all three — no defaults, so signer and verifier
 * cannot drift apart silently):
 *   AUTHN_URL — base URL of s-authn (JWKS fetched from `${AUTHN_URL}/authn/auth/jwks`)
 *   JWT_ISSUER — expected `iss` claim (platform value: `s-authn`)
 *   JWT_AUDIENCE — expected `aud` claim (platform value: `s-platform`)
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const authnUrl = process.env.AUTHN_URL;
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
/**
 * Test helper — drop the cached JWKS set. The integration harness spins
 * up a fresh JWT stub on a new port per test file; without this reset,
 * later files keep the first file's JWKS URL and every request 401s.
 */
export function __resetJwksForTests(): void {
  jwks = null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var not set — required for JWT verification`);
  }
  return value;
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: requireEnv("JWT_ISSUER"),
      audience: requireEnv("JWT_AUDIENCE"),
    });

    if (!payload.sub) {
      throw new UnauthorizedError("Token missing sub claim");
    }

    return payload as AccessTokenPayload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError(err instanceof Error ? err.message : "Token verification failed");
  }
}
