import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("Apple login preserves its verified email as a binding label", async () => {
  const audience = "test-client";
  const issuer = "https://appleid.apple.com";
  const email = "apple-test@privaterelay.appleid.com";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const clientKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
    .export({ format: "pem", type: "pkcs8" }).toString();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-rsa" };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  let proof = "";
  const runtime = await createApplication({ identityAuth: {
    clients: {
      async get() { return { clientId: audience, teamId: "team", keyId: "key", secretKey: "secret" }; },
      async readSecret() { return clientKey; },
    },
    fetcher: async (input) => String(input).endsWith("/auth/keys")
      ? Response.json({ keys: [jwk] })
      : Response.json({ id_token: proof }),
  } });
  const headers = { "x-app-id": "ai_novel", "x-platform": "macos", "x-app-region": "CN" };
  const request = (path: string, body: object) => runtime.app.handle({
    method: "POST", path: `/api/v1/auth/${path}`, headers, ipAddress: "192.0.2.50",
    body: { appId: "ai_novel", clientType: "app", ...body },
  });

  try {
    let userId: string | undefined;
    let revision: number | undefined;
    for (const [claims, expectedLabel] of [
      [{ email, email_verified: "false" }, undefined],
      [{ email, email_verified: "true" }, email],
      [{}, email],
    ] as const) {
      const authorization = await request("third-party/authorizations", { provider: "apple", purpose: "login" });
      assert.equal(authorization.statusCode, 200);
      const attempt = authorization.body.data;
      const now = Math.floor(Date.now() / 1000);
      const message = `${encode({ alg: "RS256", kid: "test-rsa" })}.${encode({
        iss: issuer, aud: audience, sub: "apple-test-subject", iat: now, exp: now + 300,
        nonce: attempt.parameters.nonce, ...claims,
      })}`;
      proof = `${message}.${sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url")}`;
      const login = await request("login/third-party", {
        authorizationId: attempt.authorizationId,
        credential: { type: "apple", identityToken: proof, authorizationCode: "test-code" },
      });
      assert.equal(login.statusCode, 200);
      const { user, accessToken } = login.body.data;
      userId ??= user.id;
      revision ??= user.accountSecurity.revision;
      assert.equal(user.id, userId);
      assert.equal(user.accountSecurity.revision, revision);
      const me = await runtime.app.handle({
        method: "GET", path: "/api/v1/users/me", headers: { ...headers, authorization: `Bearer ${accessToken}` },
      });
      assert.equal(me.statusCode, 200);
      const expected = [{ kind: "apple", ...(expectedLabel ? { displayName: expectedLabel } : {}) }];
      assert.deepEqual(user.accountSecurity.bindings, expected);
      assert.deepEqual(me.body.data.user.accountSecurity.bindings, expected);
      assert.ok(!me.body.data.user.email);
    }
    assert.ok(!JSON.stringify(runtime.logger.records).includes(email));
  } finally {
    await runtime.close();
  }
});
