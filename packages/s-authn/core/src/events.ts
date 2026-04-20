import { z } from "zod";

/**
 * Event schemas published by s-authn.
 *
 * The AsyncAPI doc in `packages/s-authn/contracts/events.asyncapi.json`
 * is generated from these at `bun run contracts:build`. Downstream
 * modules read that file to build consumer contract tests.
 */

export const UserRegisteredPayload = z
  .object({
    userId: z.string(),
    email: z.string().email(),
    occurredAt: z.string(),
  })
  .strict();
export type UserRegisteredPayload = z.infer<typeof UserRegisteredPayload>;

export const UserEnabledPayload = z.object({ userId: z.string() }).strict();
export type UserEnabledPayload = z.infer<typeof UserEnabledPayload>;

export const UserDisabledPayload = z.object({ userId: z.string() }).strict();
export type UserDisabledPayload = z.infer<typeof UserDisabledPayload>;

export const UserPasswordChangedPayload = z.object({ userId: z.string() }).strict();
export type UserPasswordChangedPayload = z.infer<typeof UserPasswordChangedPayload>;

/**
 * Catalog consumed by `scripts/build-contracts.ts` when emitting the
 * module's AsyncAPI document. Keys are event names; values carry the
 * Zod schema + a human-readable summary + an example payload.
 */
export const authnEventCatalog = {
  "user.registered": {
    schema: UserRegisteredPayload,
    summary: "A new user identity was created (INSERT on AuthnUsers).",
    example: {
      userId: "01HXYUSER000000000000000000",
      email: "alice@example.com",
      occurredAt: "2026-04-20T00:00:00.000Z",
    },
  },
  "user.enabled": {
    schema: UserEnabledPayload,
    summary: "An existing user was re-enabled (enabled: false → true).",
    example: { userId: "01HXYUSER000000000000000000" },
  },
  "user.disabled": {
    schema: UserDisabledPayload,
    summary: "An existing user was disabled (enabled: true → false).",
    example: { userId: "01HXYUSER000000000000000000" },
  },
  "user.password.changed": {
    schema: UserPasswordChangedPayload,
    summary: "A user changed their password (passwordHash mutated).",
    example: { userId: "01HXYUSER000000000000000000" },
  },
} as const;
