import { z } from "@hono/zod-openapi";

export const RegisterBody = z
  .object({
    email: z.string().email().openapi({ example: "alice@example.com" }),
    password: z.string().min(8).max(128).openapi({ example: "Test1234!" }),
  })
  .openapi("RegisterBody");

export const LoginBody = z
  .object({
    email: z.string().email(),
    password: z.string(),
  })
  .openapi("LoginBody");

export const RefreshTokenBody = z
  .object({
    refreshToken: z.string(),
  })
  .openapi("RefreshTokenBody");

export const ChangePasswordBody = z
  .object({
    currentPassword: z.string(),
    newPassword: z.string().min(8).max(128),
  })
  .openapi("ChangePasswordBody");

export const TokenResponse = z
  .object({
    data: z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresIn: z.number(),
    }),
  })
  .openapi("TokenResponse");

export const AccessTokenResponse = z
  .object({
    data: z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresIn: z.number(),
    }),
  })
  .openapi("AccessTokenResponse");

export const JwksResponse = z
  .object({
    keys: z.array(
      z.object({
        kid: z.string(),
        kty: z.string(),
        alg: z.string(),
        use: z.string(),
        n: z.string(),
        e: z.string(),
      }),
    ),
  })
  .openapi("JwksResponse");
