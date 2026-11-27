import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { AuthIdentityDirectory } from "../../src/modules/auth/identity/auth-identity-directory.ts";
import { serializeUserProfile } from "../../src/modules/user/user-profile-serialization.ts";

// Wire-decoding contract of youwo_network 2.5.2 (FlutterDemo 45163d2):
// YouwoUser.fromJson -> YouwoAccountSecurity.fromJson maps every binding ->
// YouwoIdentityKind.values.byName. Unknown kinds throw before session persistence.
const legacyKinds = ["email", "phone", "wechat", "google", "apple"];
function legacyUserParser(user: { id: string; accountSecurity: { revision: number; bindings: { kind: string }[] } }) {
  for (const binding of user.accountSecurity.bindings)
    assert.ok(legacyKinds.includes(binding.kind), `Legacy values.byName cannot decode ${binding.kind}`);
  return user;
}

type Runtime = Awaited<ReturnType<typeof createApplication>>;
function request(runtime: Runtime, path: string, body?: object, token?: string,
  version?: string, platform = "android") {
  return runtime.app.handle({ method: body ? "POST" : "GET", path: `/api/v1/${path}`, ipAddress: "192.0.2.49",
    headers: { "x-app-id": "ai_novel", "x-platform": platform, "x-app-region": "CN", "x-app-version": "1.8.0+1080000",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(version === undefined ? {} : { "x-identity-schema-version": version }),
    }, ...(body ? { body: { appId: "ai_novel", ...body } } : {}) });
}

async function setup() {
  const verifier = { async verify() { return { kind: "huawei" as const, subject: "compatibility-test-subject" }; } };
  const runtime = await createApplication({ identityAuth: {
    clients: { async get() { return { clientId: "compatibility-client", secretKey: "fixture" }; },
      async readSecret() { return "fixture"; } },
    verifiers: { huawei: verifier, apple: verifier, google: verifier, wechat: verifier },
  } });
  const loginBody = { account: "alice@example.com", password: "Password1234", clientType: "app" };
  const original = await request(runtime, "auth/login", loginBody);
  assert.equal(original.statusCode, 200);
  const initial = original.body.data;
  const change = await request(runtime, "auth/identity-changes", { kind: "huawei", expectedMode: "bind" },
    initial.accessToken, undefined, "ohos");
  assert.equal(change.statusCode, 200);
  const authorization = await request(runtime, "auth/third-party/authorizations", {
    provider: "huawei", purpose: "identity_change", changeId: change.body.data.changeId, clientType: "app",
  }, initial.accessToken, undefined, "ohos");
  assert.equal(authorization.statusCode, 200);
  const completeBody = { clientType: "app", proof: { type: "third_party",
    authorizationId: authorization.body.data.authorizationId,
    credential: { type: "authorization_code", code: "fixture-code", state: authorization.body.data.parameters.state },
  } };
  const completePath = `auth/identity-changes/${change.body.data.changeId}/complete`;
  return { runtime, initial, completeBody, completePath, loginBody };
}

test("schema negotiation protects old login/refresh/me/complete decoding without changing real bindings or UID", async () => {
  const { runtime, initial, completeBody, completePath, loginBody } = await setup();
  try {
    const completed = await request(runtime, completePath, completeBody, initial.accessToken, undefined, "ohos");
    assert.equal(completed.statusCode, 200);
    const oldComplete = completed.body.data.session;
    assert.equal(legacyUserParser(oldComplete.user).id, initial.user.id);
    assert.ok(oldComplete.user.accountSecurity.revision > initial.user.accountSecurity.revision);

    const oldLogin = await request(runtime, "auth/login", loginBody);
    assert.equal(oldLogin.statusCode, 200);
    assert.equal(legacyUserParser(oldLogin.body.data.user).id, initial.user.id);
    const oldRefresh = await request(runtime, "auth/refresh", { clientType: "app", refreshToken: oldLogin.body.data.refreshToken });
    assert.equal(oldRefresh.statusCode, 200);
    assert.equal(legacyUserParser(oldRefresh.body.data.user).id, initial.user.id);
    for (const version of [undefined, "1", "0", "invalid", "2-invalid", "2.0"]) {
      const me = await request(runtime, "users/me", undefined, oldRefresh.body.data.accessToken, version);
      assert.equal(me.statusCode, 200);
      assert.equal(legacyUserParser(me.body.data.user).id, initial.user.id);
      assert.ok(!me.body.data.user.accountSecurity.bindings.some((row: { kind: string }) => row.kind === "huawei"));
    }

    const directory = new AuthIdentityDirectory(runtime.database);
    assert.ok((await directory.bindings("ai_novel", initial.user.id)).some(row => row.kind === "huawei"));
    const newComplete = await request(runtime, completePath, completeBody, initial.accessToken, "2", "ohos");
    assert.equal(newComplete.statusCode, 200);
    const full = newComplete.body.data.session.user;
    assert.equal(full.id, initial.user.id);
    assert.equal(full.accountSecurity.revision, oldComplete.user.accountSecurity.revision);
    assert.ok(full.accountSecurity.bindings.some((row: { kind: string }) => row.kind === "huawei"));
    assert.throws(() => legacyUserParser(full), /cannot decode huawei/);

    for (const platform of ["android", "ios", "ohos", "macos", "windows", "web"]) {
      const me = await request(runtime, "users/me", undefined, oldRefresh.body.data.accessToken, "2", platform);
      assert.equal(me.statusCode, 200);
      assert.equal(me.body.data.user.id, initial.user.id);
      assert.ok(me.body.data.user.accountSecurity.bindings.some((row: { kind: string }) => row.kind === "huawei"));
      assert.equal(me.body.data.user.accountSecurity.revision, full.accountSecurity.revision);
    }
    const v2Login = await request(runtime, "auth/login", loginBody, undefined, "2");
    assert.equal(v2Login.statusCode, 200);
    assert.ok(v2Login.body.data.user.accountSecurity.bindings.some((row: { kind: string }) => row.kind === "huawei"));
    const v2Refresh = await request(runtime, "auth/refresh", { clientType: "app", refreshToken: v2Login.body.data.refreshToken }, undefined, "2");
    assert.equal(v2Refresh.statusCode, 200);
    assert.ok(v2Refresh.body.data.user.accountSecurity.bindings.some((row: { kind: string }) => row.kind === "huawei"));
  } finally { await runtime.close(); }
});

test("identity serialization projection leaves the authoritative profile unchanged", () => {
  const profile = { id: "fixture", name: "fixture", hasPassword: false, avatarUrl: null,
    accountSecurity: { revision: 8, bindings: [{ kind: "email" as const }, { kind: "huawei" as const }] } };
  const legacy = serializeUserProfile(profile);
  assert.deepEqual(legacy.accountSecurity?.bindings, [{ kind: "email" }]);
  assert.equal(legacy.accountSecurity?.revision, 8);
  assert.deepEqual(profile.accountSecurity.bindings, [{ kind: "email" }, { kind: "huawei" }]);
  assert.strictEqual(serializeUserProfile(profile, "2"), profile);
  assert.strictEqual(serializeUserProfile(profile, "3"), profile);
});
