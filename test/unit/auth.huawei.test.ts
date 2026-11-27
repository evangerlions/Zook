import assert from "node:assert/strict";
import { constants, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { HuaweiIdentityVerifier } from "../../src/modules/auth/third-party/huawei-identity-verifier.ts";
import { OidcTokenVerifier } from "../../src/modules/auth/third-party/oidc-token-verifier.ts";
import type { ThirdPartyAttempt } from "../../src/modules/auth/third-party/third-party-models.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "huawei-fixture-key", alg: "RS256", use: "sig" };
const clients = { async get() { return { clientId: "huawei-client", secretKey: "fixture-key" }; },
  async readSecret() { return "fixture-secret"; } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(nonce: string, overrides: object = {}, header: object = {}) {
  const now = Math.floor(Date.now() / 1000);
  const message = `${encode({ alg: "RS256", kid: jwk.kid, ...header })}.${encode({
    iss: "https://accounts.huawei.com", aud: "huawei-client", sub: "huawei-subject",
    nonce, iat: now, exp: now + 300, display_name: "Huawei nickname", ...overrides,
  })}`;
  const signingKey = (header as { alg?: string }).alg === "PS256"
    ? { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } : privateKey;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), signingKey).toString("base64url")}`;
}

const attempt = { platform: "ohos", transport: "sdk", clientType: "app", clientId: "huawei-client",
  audience: "huawei-client", nonce: "server-nonce", state: "server-state" } as ThirdPartyAttempt;
const credential = { type: "authorization_code" as const, code: "provider-code+/=", state: "server-state" };

function providerFetch(proof: () => string, exchanges: URLSearchParams[] = []): typeof fetch {
  return (async (url: string | URL | Request, input?: RequestInit) => {
    if (String(url).endsWith("/token")) {
      assert.equal(String(url), "https://oauth-login.cloud.huawei.com/oauth2/v3/token");
      assert.equal(input?.method, "POST");
      assert.equal(input?.redirect, "error");
      exchanges.push(new URLSearchParams(String(input?.body)));
      return Response.json({ id_token: proof(), access_token: "unused-private-token" });
    }
    assert.equal(String(url), "https://oauth-login.cloud.huawei.com/oauth2/v3/certs");
    return Response.json({ keys: [jwk, { ...jwk, alg: "PS256" }] });
  }) as typeof fetch;
}

test("Huawei verifies server-exchanged signed identity and keeps the secret off the client", async () => {
  const exchanges: URLSearchParams[] = [];
  const verifier = new HuaweiIdentityVerifier(clients, providerFetch(() => token(attempt.nonce), exchanges));
  assert.deepEqual(await verifier.verify(attempt, credential, (await clients.get())), {
    kind: "huawei", subject: "openid:huawei-client:huawei-subject", displayName: "Huawei nickname",
  });
  assert.equal(exchanges.length, 1);
  assert.deepEqual(Object.fromEntries(exchanges[0]), { grant_type: "authorization_code", client_id: "huawei-client",
    client_secret: "fixture-secret", code: credential.code, supportAlg: "PS256" });
});

test("Huawei also verifies PS256 signatures with digest-length PSS salt", async () => {
  const verifier = new HuaweiIdentityVerifier(clients, providerFetch(() => token(attempt.nonce, {}, { alg: "PS256" })));
  assert.equal((await verifier.verify(attempt, credential, await clients.get())).kind, "huawei");
});

test("PS256 is opt-in and a mismatched JWK algorithm cannot verify it", async () => {
  const proof = token(attempt.nonce, {}, { alg: "PS256" });
  const originalPolicy = new OidcTokenVerifier("https://oauth-login.cloud.huawei.com/oauth2/v3/certs",
    ["https://accounts.huawei.com"], providerFetch(() => proof));
  await assert.rejects(() => originalPolicy.verify(proof, attempt.audience, attempt.nonce),
    { code: "AUTH_PROVIDER_PROOF_INVALID" });
  const wrongKeyPolicy = new OidcTokenVerifier("https://oauth-login.cloud.huawei.com/oauth2/v3/certs",
    ["https://accounts.huawei.com"], (async () => Response.json({ keys: [jwk] })) as typeof fetch, ["PS256"]);
  await assert.rejects(() => wrongKeyPolicy.verify(proof, attempt.audience, attempt.nonce),
    { code: "AUTH_PROVIDER_PROOF_INVALID" });
});

test("Huawei rejects client-reported IDs, incorrect state, platform and transport before exchanging", async () => {
  const exchanges: URLSearchParams[] = [];
  const verifier = new HuaweiIdentityVerifier(clients, providerFetch(() => token(attempt.nonce), exchanges));
  for (const [auth, proof] of [
    [attempt, { type: "id_token", idToken: token(attempt.nonce) }],
    [attempt, { ...credential, state: "wrong" }],
    [{ ...attempt, platform: "android" }, credential],
    [{ ...attempt, clientType: "web" }, credential],
    [{ ...attempt, transport: "browser" }, credential],
  ] as const) {
    await assert.rejects(() => verifier.verify(auth as ThirdPartyAttempt, proof as typeof credential, { clientId: "huawei-client", secretKey: "fixture-key" }),
      { code: "AUTH_PROVIDER_PROOF_INVALID" });
  }
  assert.equal(exchanges.length, 0);
});

test("Huawei rejects invalid issuer/audience/nonce/time/signature/algorithm", async () => {
  const proofs = [token("wrong"), token(attempt.nonce, { iss: "https://attacker.example" }),
    token(attempt.nonce, { aud: "another-client" }), token(attempt.nonce, { exp: 0 }),
    token(attempt.nonce, { iat: Math.floor(Date.now() / 1000) + 3600 }), token(attempt.nonce, { sub: "" }),
    token(attempt.nonce, {}, { alg: "HS256" }), token(attempt.nonce).slice(0, -12) + "tampered0000"];
  for (const proof of proofs) {
    const verifier = new HuaweiIdentityVerifier(clients, providerFetch(() => proof));
    await assert.rejects(() => verifier.verify(attempt, credential, { clientId: "huawei-client", secretKey: "fixture-key" }),
      { code: "AUTH_PROVIDER_PROOF_INVALID" });
  }
});

test("Huawei token exchange failure and missing managed secret fail closed", async () => {
  const unavailable = new HuaweiIdentityVerifier({ ...clients, async readSecret() { return undefined; } });
  await assert.rejects(() => unavailable.verify(attempt, credential, { clientId: "huawei-client", secretKey: "fixture-key" }),
    { code: "AUTH_PROVIDER_UNAVAILABLE", statusCode: 503 });
  for (const response of [Response.json({ error: 1203, error_description: "secret-upstream-error" }, { status: 400 }),
    Response.json({ access_token: "only-access-token" }), Response.json({ id_token: 123 }),
    new Response("not json", { status: 502 })]) {
    const verifier = new HuaweiIdentityVerifier(clients, (async () => response) as typeof fetch);
    await assert.rejects(() => verifier.verify(attempt, credential, { clientId: "huawei-client", secretKey: "fixture-key" }),
      { code: "AUTH_PROVIDER_PROOF_INVALID", message: "Huawei authorization could not be verified." });
  }
});

type Runtime = Awaited<ReturnType<typeof createApplication>>;
function call(runtime: Runtime, path: string, body: object, accessToken?: string, platform = "ohos") {
  return runtime.app.handle({ method: "POST", path: `/api/v1/${path}`, ipAddress: "192.0.2.48",
    headers: { "x-app-id": "ai_novel", "x-platform": platform, "x-app-region": "CN",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: { appId: "ai_novel", ...body } });
}

test("Huawei login is single-use and binding retains the UID and is visible on every platform", async () => {
  let nonce = "";
  const runtime = await createApplication({ identityAuth: { clients, fetcher: providerFetch(() => token(nonce)) } });
  try {
    const create = async (purpose = "login", accessToken?: string, changeId?: string) => {
      const response = await call(runtime, "auth/third-party/authorizations", { provider: "huawei", purpose,
        clientType: "app", ...(changeId ? { changeId } : {}) }, accessToken);
      assert.equal(response.statusCode, 200);
      nonce = response.body.data.parameters.nonce;
      assert.ok(!JSON.stringify(response.body).includes("fixture-secret"));
      return response.body.data;
    };
    const original = await call(runtime, "auth/login", { account: "alice@example.com", password: "Password1234", clientType: "app" });
    assert.equal(original.statusCode, 200);
    const change = await call(runtime, "auth/identity-changes", { kind: "huawei", expectedMode: "bind" }, original.body.data.accessToken);
    assert.equal(change.statusCode, 200);
    const authorization = await create("identity_change", original.body.data.accessToken, change.body.data.changeId);
    const proof = { ...credential, state: authorization.parameters.state };
    const bound = await call(runtime, `auth/identity-changes/${change.body.data.changeId}/complete`, { clientType: "app",
      proof: { type: "third_party", authorizationId: authorization.authorizationId, credential: proof } }, original.body.data.accessToken);
    assert.equal(bound.statusCode, 200);
    assert.equal(bound.body.data.session.user.id, original.body.data.user.id);
    for (const platform of ["ios", "android", "ohos", "macos", "windows", "web"]) {
      const profile = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me", headers: {
        "x-app-id": "ai_novel", "x-platform": platform, authorization: `Bearer ${bound.body.data.session.accessToken}` } });
      assert.equal(profile.statusCode, 200);
      assert.deepEqual(profile.body.data.user.accountSecurity.bindings.find((row: { kind: string }) => row.kind === "huawei"),
        { kind: "huawei", displayName: "Huawei nickname" });
    }
    const loginAuthorization = await create();
    const request = { authorizationId: loginAuthorization.authorizationId, clientType: "app",
      credential: { ...credential, state: loginAuthorization.parameters.state } };
    const loggedIn = await call(runtime, "auth/login/third-party", request);
    assert.equal(loggedIn.statusCode, 200);
    assert.equal(loggedIn.body.data.user.id, original.body.data.user.id);
    assert.equal((await call(runtime, "auth/login/third-party", request)).statusCode, 400);
    for (const platform of ["ios", "android", "macos", "windows", "web"]) {
      const rejected = await call(runtime, "auth/third-party/authorizations", { provider: "huawei", purpose: "login", clientType: "app" }, undefined, platform);
      assert.equal(rejected.statusCode, 503);
    }
    const logs = JSON.stringify(runtime.logger.records);
    for (const secret of ["fixture-secret", "provider-code", "unused-private-token", "huawei-subject", "Huawei nickname"])
      assert.ok(!logs.includes(secret));
  } finally { await runtime.close(); }
});
