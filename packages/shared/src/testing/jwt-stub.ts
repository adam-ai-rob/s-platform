import * as http from "node:http";
import * as net from "node:net";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/**
 * Test JWT signer + JWKS server.
 *
 * Mints an RS256 keypair in-memory, exposes the public JWK at
 * `http://127.0.0.1:{port}/authn/auth/jwks`, and issues access tokens
 * signed by the private key. Tests set `AUTHN_URL` to the returned base
 * URL so `packages/shared/src/auth/verify.ts` (which uses
 * `createRemoteJWKSet`) fetches this stub JWKS instead of a deployed
 * s-authn.
 */
export interface JwtStub {
  baseUrl: string;
  port: number;
  sign(options: SignOptions): Promise<string>;
  stop(): Promise<void>;
}

export interface SignOptions {
  sub: string;
  system?: boolean;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("failed to allocate free port")));
      }
    });
  });
}

export async function startJwtStub(): Promise<JwtStub> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const jwks = { keys: [publicJwk] };

  const port = await findFreePort();
  const server = http.createServer((req, res) => {
    if (req.url === "/authn/auth/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    async sign({ sub, system, issuer, audience, expiresIn }) {
      const jwt = new SignJWT({
        ...(system === true ? { system: true } : {}),
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setSubject(sub)
        .setIssuer(issuer ?? process.env.JWT_ISSUER ?? "s-authn")
        .setAudience(audience ?? process.env.JWT_AUDIENCE ?? "s-platform")
        .setIssuedAt()
        .setExpirationTime(expiresIn ?? "5m");
      return jwt.sign(privateKey);
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
