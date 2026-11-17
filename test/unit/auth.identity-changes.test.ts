import { NoopRegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { AuthIdentityDirectory } from "../../src/modules/auth/identity/auth-identity-directory.ts";

type Runtime = Awaited<ReturnType<typeof createApplication>>;
const phoneA = "13800000001";
const phoneB = "13800000002";

async function setup() {
  const deliveries: { phoneNumber: string; code: string }[] = [];
  const runtime = await createApplication({ registrationCodeGenerator: () => "123456",
    smsVerificationSender: { async sendVerificationCode(input) { deliveries.push(input); return { provider: "tencent_sms", phoneNumber: input.phoneNumber }; } },
    registrationEmailSender: new NoopRegistrationEmailSender(),
  });
  return { runtime, deliveries };
}

function call(runtime: Runtime, path: string, body: object, token?: string) {
  return runtime.app.handle({ method: "POST", path: `/api/v1/${path}`,
    headers: { "x-app-id": "ai_novel", "x-platform": "ios", "x-app-region": "CN",
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: { appId: "ai_novel", ...body }, ipAddress: "198.51.100.131" });
}

async function loginPhone(runtime: Runtime, phone: string) {
  const sent = await call(runtime, "auth/login/sms-code", { phone, phoneNa: "+86" });
  assert.equal(sent.statusCode, 200);
  const login = await call(runtime, "auth/login/sms", { phone, phoneNa: "+86", smsCode: "123456", clientType: "app" });
  assert.equal(login.statusCode, 200);
  return login.body.data;
}

async function loginAlice(runtime: Runtime) {
  const result = await call(runtime, "auth/login", { account: "alice@example.com", password: "Password1234", clientType: "app" });
  assert.equal(result.statusCode, 200);
  return result.body.data;
}

test("new binding only verifies target; retains UID/global fields and exposes additive UserInfo", async () => {
  const { runtime } = await setup();
  const original = await loginAlice(runtime);
  const create = await call(runtime, "auth/identity-changes", { kind: "phone", expectedMode: "bind" }, original.accessToken);
  assert.equal(create.statusCode, 200);
  assert.equal(create.body.data.nextStep, "verify_target");
  assert.deepEqual(create.body.data.verificationMethods, []);
  const id = create.body.data.changeId;
  const code = await call(runtime, `auth/identity-changes/${id}/codes`, { stage: "target", method: "sms_code", phone: phoneB, phoneNa: "+86" }, original.accessToken);
  assert.equal(code.statusCode, 200);
  const complete = await call(runtime, `auth/identity-changes/${id}/complete`, { clientType: "app",
    proof: { type: "sms_code", challengeId: code.body.data.challengeId, code: "123456" } }, original.accessToken);
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.body.data.session.user.id, original.user.id);
  assert.equal(complete.body.data.session.user.phone, `+86${phoneB}`);
  assert.equal(runtime.database.findUserById(original.user.id)?.phone, undefined);
  assert.equal((await runtime.database.listSmsVerificationRecords("ai_novel")).filter(row => row.scene === "identity-change")[0].status, "consumed");
  assert.equal(runtime.database.findUserById(original.user.id)?.email, "alice@example.com");
  const profile = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me",
    headers: { "x-app-id": "ai_novel", authorization: `Bearer ${complete.body.data.session.accessToken}` } });
  assert.equal(profile.statusCode, 200);
  assert.ok(profile.body.data.membership);
  assert.deepEqual(profile.body.data.user, complete.body.data.session.user);
  const log = JSON.stringify(runtime.logger.records);
  assert.ok(log.includes("auth.identity_change.applied"));
  assert.ok(!log.includes(phoneB) && !log.includes("123456") && !log.includes("Password1234"));
});

test("replacement requires old proof; old phone re-registers empty UID on legacy route without global reassignment", async () => {
  const { runtime } = await setup();
  const original = await loginPhone(runtime, phoneA);
  const create = await call(runtime, "auth/identity-changes", { kind: "phone", expectedMode: "replace" }, original.accessToken);
  assert.equal(create.body.data.nextStep, "verify_current");
  const id = create.body.data.changeId;
  const premature = await call(runtime, `auth/identity-changes/${id}/codes`, { stage: "target", method: "sms_code", phone: phoneB }, original.accessToken);
  assert.equal(premature.statusCode, 403);
  const oldCode = await call(runtime, `auth/identity-changes/${id}/codes`, { stage: "current", method: "sms_code" }, original.accessToken);
  const verify = await call(runtime, `auth/identity-changes/${id}/verify-current`, { method: "sms_code", challengeId: oldCode.body.data.challengeId, code: "123456" }, original.accessToken);
  assert.equal(verify.statusCode, 200);
  const newCode = await call(runtime, `auth/identity-changes/${id}/codes`, { stage: "target", method: "sms_code", phone: phoneB }, original.accessToken);
  const complete = await call(runtime, `auth/identity-changes/${id}/complete`, { clientType: "app",
    proof: { type: "sms_code", challengeId: newCode.body.data.challengeId, code: "123456" } }, original.accessToken);
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.body.data.session.user.id, original.user.id);
  assert.equal(complete.body.data.session.user.phone, `+86${phoneB}`);
  const fresh = await loginPhone(runtime, phoneA);
  assert.notEqual(fresh.user.id, original.user.id);
  assert.equal(fresh.user.hasPassword, false);
  assert.equal(runtime.database.findUserByPhone(`+86${phoneA}`)?.id, original.user.id);
  const directory = new AuthIdentityDirectory(runtime.database);
  assert.equal((await directory.find("ai_novel", "phone", `+86${phoneA}`))?.id, fresh.user.id);
  assert.equal((await directory.find("ai_novel", "phone", `+86${phoneB}`))?.id, original.user.id);
  assert.equal((await directory.find("app_a", "phone", `+86${phoneA}`))?.id, original.user.id);
  const oldAccess = await runtime.app.handle({method:"GET",path:"/api/v1/users/me",
    headers:{"x-app-id":"ai_novel",authorization:`Bearer ${original.accessToken}`}});
  assert.equal(oldAccess.statusCode,401);
  const oldRefresh = await call(runtime, "auth/refresh", { refreshToken: original.refreshToken, clientType: "app" });
  assert.equal(oldRefresh.statusCode, 401);
});

test("active identity conflict is not reassigned; deleted source may bind; account deletion clears pending changes", async () => {
  const { runtime } = await setup();
  const source = await loginPhone(runtime, phoneA);
  const keep = await loginAlice(runtime);
  const directory = new AuthIdentityDirectory(runtime.database);
  await assert.rejects(() => directory.bind("ai_novel", keep.user.id, "phone", `+86${phoneA}`), { code: "AUTH_IDENTITY_ALREADY_BOUND" });
  assert.equal((await directory.find("ai_novel", "phone", `+86${phoneA}`))?.id, source.user.id);
  await runtime.database.updateAppUserStatus("ai_novel", source.user.id, "DELETED");
  await directory.bind("ai_novel", keep.user.id, "phone", `+86${phoneA}`);
  assert.equal((await directory.find("ai_novel", "phone", `+86${phoneA}`))?.id, keep.user.id);
  assert.equal(runtime.database.findUserByPhone(`+86${phoneA}`)?.id, source.user.id);
  const change = await call(runtime, "auth/identity-changes", { kind: "phone", expectedMode: "replace" }, keep.accessToken);
  assert.equal(change.statusCode, 200);
  const deleted = await call(runtime, "users/me/delete", { confirmation: "DELETE" }, keep.accessToken);
  assert.equal(deleted.statusCode, 200);
  assert.equal(await runtime.database.authIdentityStore.getChange(change.body.data.changeId), undefined);
  assert.ok(await runtime.database.authIdentityStore.findBinding("ai_novel", "phone", `+86${phoneA}`));
});

test("password failure does not clear session; stale mode/revision and foreign operations are rejected", async () => {
  const { runtime } = await setup();
  const owner = await loginAlice(runtime);
  const change = await call(runtime, "auth/identity-changes", { kind: "email", expectedMode: "replace" }, owner.accessToken);
  const id = change.body.data.changeId;
  const wrong = await call(runtime, `auth/identity-changes/${id}/verify-current`, { method: "password", password: "incorrect" }, owner.accessToken);
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.body.code, "AUTH_CURRENT_PASSWORD_INVALID");
  const valid = await call(runtime, `auth/identity-changes/${id}/verify-current`, { method: "password", password: "Password1234" }, owner.accessToken);
  assert.equal(valid.statusCode, 200);
  const stranger = await loginPhone(runtime, phoneB);
  const foreign = await call(runtime, `auth/identity-changes/${id}/verify-current`, { method: "password", password: "Password1234" }, stranger.accessToken);
  assert.equal(foreign.statusCode, 403);
  const wrongMode = await call(runtime, "auth/identity-changes", { kind: "email", expectedMode: "bind" }, owner.accessToken);
  assert.equal(wrongMode.statusCode, 409);
  const directory = new AuthIdentityDirectory(runtime.database);
  await directory.bind("ai_novel", owner.user.id, "email", "new@example.com");
  const stale = await call(runtime, `auth/identity-changes/${id}/codes`, { stage: "target", method: "email_code", email: "newer@example.com" }, owner.accessToken);
  assert.equal(stale.statusCode, 409);
});
