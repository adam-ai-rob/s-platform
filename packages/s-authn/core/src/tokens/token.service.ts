import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { logger } from "@s/shared/logger";
import { exportJWK, importSPKI, type JWK } from "jose";
import { ulid } from "ulid";

/**
 * JWT signing + JWKS publication using AWS KMS.
 *
 * We build the JWT manually (header.payload.signature) because jose's
 * sign() can't delegate to KMS. SHA-256 digest of the signing input is
 * computed locally, then KMS signs the digest.
 *
 * KMS key: `alias/s-authn-jwt-{stage}` (provisioned in infra/shared.ts).
 * Algorithm: RSASSA_PKCS1_V1_5_SHA_256 (RS256 in JWT terms).
 */

let kmsClient: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (!kmsClient) {
    kmsClient = new KMSClient({
      region: process.env.AWS_REGION ?? "eu-west-1",
    });
  }
  return kmsClient;
}

const ISS = process.env.JWT_ISSUER ?? "s-authn";
const AUD = process.env.JWT_AUDIENCE ?? "s-platform";

function getKeyAlias(): string {
  const alias = process.env.KMS_KEY_ALIAS;
  if (!alias) throw new Error("KMS_KEY_ALIAS env var not set");
  return alias;
}

// ─── JWT signing ──────────────────────────────────────────────────────────────

async function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): Promise<string> {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: getKeyAlias(),
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISS,
    aud: AUD,
    iat: now,
    exp: now + expiresInSeconds,
    ...payload,
  };

  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

  const headerB64 = enc(header);
  const payloadB64 = enc(claims);
  const signingInput = `${headerB64}.${payloadB64}`;

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signingInput)),
  );

  const res = await getKmsClient().send(
    new SignCommand({
      KeyId: getKeyAlias(),
      Message: digest,
      MessageType: "DIGEST",
      SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
    }),
  );

  if (!res.Signature) throw new Error("KMS returned no signature");
  const signatureB64 = Buffer.from(res.Signature).toString("base64url");

  return `${signingInput}.${signatureB64}`;
}

export async function issueAccessToken(userId: string): Promise<string> {
  return signJwt({ sub: userId }, 3600); // 1 hour
}

export interface IssueRefreshTokenResult {
  token: string;
  jti: string;
  expiresAt: Date;
}

export async function issueRefreshToken(userId: string): Promise<IssueRefreshTokenResult> {
  const jti = ulid();
  const expiresInSeconds = 86400; // 24 hours
  const token = await signJwt({ sub: userId, jti }, expiresInSeconds);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  return { token, jti, expiresAt };
}

// ─── JWKS ─────────────────────────────────────────────────────────────────────

interface JwksKey extends JWK {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

let jwksCache: { keys: JwksKey[]; cachedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 3_600_000; // 1 hour

export async function getJwks(): Promise<{ keys: JwksKey[] }> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.cachedAt < JWKS_CACHE_TTL_MS) {
    return { keys: jwksCache.keys };
  }

  const res = await getKmsClient().send(
    new GetPublicKeyCommand({
      KeyId: getKeyAlias(),
    }),
  );

  if (!res.PublicKey) throw new Error("KMS returned no public key");

  // res.PublicKey is DER-encoded SPKI. Wrap as PEM for jose.importSPKI,
  // then use jose.exportJWK — importSPKI returns a KeyObject under Node,
  // which can't be passed to crypto.subtle.exportKey directly.
  const pem = derToPem(res.PublicKey, "PUBLIC KEY");
  const keyLike = await importSPKI(pem, "RS256", { extractable: true });
  const jwk = await exportJWK(keyLike);

  if (!jwk.n || !jwk.e) {
    throw new Error("KMS public key missing RSA components (n, e)");
  }

  const key: JwksKey = {
    kid: getKeyAlias(),
    kty: "RSA",
    alg: "RS256",
    use: "sig",
    n: jwk.n,
    e: jwk.e,
  };

  jwksCache = { keys: [key], cachedAt: now };
  logger.info("🔑 JWKS refreshed from KMS", { kid: key.kid });

  return { keys: [key] };
}

function derToPem(der: Uint8Array, label: string): string {
  const base64 = Buffer.from(der).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}
