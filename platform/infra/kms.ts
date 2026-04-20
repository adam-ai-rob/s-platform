/**
 * Platform KMS — RSA-4096 JWT signing key.
 *
 * s-authn uses this key via `kms:Sign` + `kms:GetPublicKey` to mint and
 * rotate tokens. Every other module verifies JWTs via JWKS (s-authn's
 * `/authn/.well-known/jwks.json`), so they never need access to this key.
 *
 * The key ARN + alias are published to SSM by `ssm-outputs.ts` so the
 * s-authn module SST app can attach an IAM policy referencing the ARN
 * without a code-level import of this file.
 */

import * as aws from "@pulumi/aws";

export const jwtSigningKey = new aws.kms.Key("JwtSigningKey", {
  description: `s-authn JWT signing key (${$app.stage})`,
  keyUsage: "SIGN_VERIFY",
  customerMasterKeySpec: "RSA_4096",
  deletionWindowInDays: $app.stage === "prod" ? 30 : 7,
  enableKeyRotation: false, // RSA signing keys don't auto-rotate
});

export const jwtSigningKeyAlias = new aws.kms.Alias("JwtSigningKeyAlias", {
  name: `alias/s-authn-jwt-${$app.stage}`,
  targetKeyId: jwtSigningKey.keyId,
});
