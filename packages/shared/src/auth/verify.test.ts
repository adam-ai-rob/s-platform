import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { UnauthorizedError } from "../errors/domain-error";
import { startJwtStub } from "../testing/jwt-stub";
import { __resetJwksForTests, verifyAccessToken } from "./verify";

const ENV_VARS = ["AUTHN_URL", "JWT_ISSUER", "JWT_AUDIENCE"] as const;

describe("verifyAccessToken", () => {
  const original: Partial<Record<(typeof ENV_VARS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const v of ENV_VARS) original[v] = process.env[v];
    __resetJwksForTests();
  });

  afterEach(() => {
    for (const v of ENV_VARS) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
    __resetJwksForTests();
  });

  test("accepts a token with matching issuer and audience", async () => {
    const stub = await startJwtStub();
    process.env.AUTHN_URL = stub.baseUrl;
    process.env.JWT_ISSUER = "s-authn";
    process.env.JWT_AUDIENCE = "s-platform";

    const token = await stub.sign({ sub: "user-1" });
    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe("user-1");
  });

  test("rejects a token with mismatched issuer", async () => {
    const stub = await startJwtStub();
    process.env.AUTHN_URL = stub.baseUrl;
    process.env.JWT_ISSUER = "s-authn";
    process.env.JWT_AUDIENCE = "s-platform";

    const token = await stub.sign({ sub: "user-1", issuer: "evil-issuer" });

    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("rejects a token with mismatched audience", async () => {
    const stub = await startJwtStub();
    process.env.AUTHN_URL = stub.baseUrl;
    process.env.JWT_ISSUER = "s-authn";
    process.env.JWT_AUDIENCE = "s-platform";

    const token = await stub.sign({ sub: "user-1", audience: "evil-audience" });

    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("throws when JWT_ISSUER env is missing", async () => {
    const stub = await startJwtStub();
    process.env.AUTHN_URL = stub.baseUrl;
    process.env.JWT_ISSUER = "s-authn";
    process.env.JWT_AUDIENCE = "s-platform";
    const token = await stub.sign({ sub: "user-1" });

    process.env.JWT_ISSUER = "";
    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("throws when JWT_AUDIENCE env is missing", async () => {
    const stub = await startJwtStub();
    process.env.AUTHN_URL = stub.baseUrl;
    process.env.JWT_ISSUER = "s-authn";
    process.env.JWT_AUDIENCE = "s-platform";
    const token = await stub.sign({ sub: "user-1" });

    process.env.JWT_AUDIENCE = "";
    await expect(verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
