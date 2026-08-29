import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import { sha256 } from "../../src/shared/utils.ts";

function authorization(token: string, appId = "lighttick") {
  return { authorization: `Bearer ${token}`, "x-app-id": appId };
}

test("LightTick is independently disabled and enabled seed includes product bootstrap", async () => {
  const disabled = await createApplication();
  assert.equal(await disabled.database.findApp("lighttick"), undefined);
  const disabledResponse = await disabled.app.handle({
    method: "GET", path: "/api/v1/lighttick/profile", headers: {}, requestId: "disabled",
  });
  assert.equal(disabledResponse.statusCode, 503);
  assert.equal(disabledResponse.body.code, "LIGHTTICK_APP_DISABLED");

  const enabled = await createApplication({ lighttickEnabled: true });
  assert.equal((await enabled.database.findApp("lighttick"))?.joinMode, "AUTO");
  assert.equal(
    (await enabled.database.findAppConfig("lighttick", "auth.default_role_code"))?.configValue,
    "member",
  );
  const delivery = await enabled.database.findAppConfig("lighttick", "admin.delivery_config");
  assert.equal(JSON.parse(delivery?.configValue ?? "{}").featureFlags.aiPlanning, false);
  assert.ok((await enabled.database.listRoles("lighttick")).some((role) => role.code === "member"));
});

test("LightTick profile route accepts only active LightTick token and membership", async () => {
  const seed = buildDefaultSeed(undefined, { includeFrogSleep: true, includeLightTick: true });
  seed.apps.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: "2026-08-19T00:00:00Z",
  });
  seed.appUsers.push({
    id: "app_user_alice_lighttick", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-19T00:00:00Z",
  });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const lighttickToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");

  const accepted = await runtime.app.handle({
    method: "GET", path: "/api/v1/lighttick/profile",
    headers: authorization(lighttickToken), requestId: "accepted",
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.user_id, "user_alice");

  for (const appId of ["bodylog", "frogsleep", "ai_novel"]) {
    const foreignToken = runtime.services.tokenService.issueAccessToken("user_alice", appId);
    const response = await runtime.app.handle({
      method: "GET", path: "/api/v1/lighttick/profile",
      headers: authorization(foreignToken, appId), requestId: `scope_${appId}`,
    });
    assert.equal(response.statusCode, 403, appId);
    assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH", appId);
  }

  const headerMismatch = await runtime.app.handle({
    method: "GET", path: "/api/v1/lighttick/profile",
    headers: authorization(lighttickToken, "bodylog"), requestId: "header_mismatch",
  });
  assert.equal(headerMismatch.statusCode, 403);

  const expiredToken = runtime.services.tokenService.issueAccessToken(
    "user_alice", "lighttick", 1, new Date(Date.now() - 60 * 60 * 1000),
  );
  const expired = await runtime.app.handle({
    method: "GET", path: "/api/v1/lighttick/profile",
    headers: authorization(expiredToken), requestId: "expired",
  });
  assert.equal(expired.statusCode, 401);

  await runtime.database.updateAppUserStatus("lighttick", "user_alice", "DELETED");
  const deletedMembership = await runtime.app.handle({
    method: "GET", path: "/api/v1/lighttick/profile",
    headers: authorization(lighttickToken), requestId: "deleted_membership",
  });
  assert.equal(deletedMembership.statusCode, 403);
});

test("LightTick account deletion revokes only LightTick membership and sessions", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "app_user_alice_lighttick", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-20T00:00:00Z" });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const accessToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  await runtime.services.refreshTokenStore.create({ id: "rft_lighttick", appId: "lighttick", userId: "user_alice",
    tokenHash: sha256("lighttick_refresh"), expiresAt: "2027-08-20T00:00:00Z" });
  await runtime.services.refreshTokenStore.create({ id: "rft_app_a", appId: "app_a", userId: "user_alice",
    tokenHash: sha256("app_a_refresh"), expiresAt: "2027-08-20T00:00:00Z" });
  const reauthentication = await runtime.services.authService.issueReauthenticationProof(
    "lighttick", "user_alice", "Password1234");

  const response = await runtime.app.handle({ method: "DELETE", path: "/api/v1/lighttick/me/account",
    headers: authorization(accessToken), body: { confirmation: "DELETE",
      reauthentication_token: reauthentication.token }, requestId: "delete_lighttick" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.membership_status, "DELETED");
  assert.equal(response.body.data.product_data_deleted, true);
  assert.equal((await runtime.database.findAppUser("lighttick", "user_alice"))?.status, "DELETED");
  assert.equal((await runtime.database.findAppUser("app_a", "user_alice"))?.status, "ACTIVE");
  assert.equal((await runtime.database.findUserById("user_alice"))?.status, "ACTIVE");
  assert.ok((await runtime.services.refreshTokenStore.getByRawToken("lighttick_refresh"))?.revokedAt);
  assert.equal((await runtime.services.refreshTokenStore.getByRawToken("app_a_refresh"))?.revokedAt, undefined);

  const afterDeletion = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/profile",
    headers: authorization(accessToken), requestId: "after_delete" });
  assert.equal(afterDeletion.statusCode, 401);
});

test("LightTick deletion requires a one-time recent password reauthentication proof", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "app_user_alice_lighttick", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-29T00:00:00Z" });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const accessToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const denied = await runtime.app.handle({ method: "DELETE", path: "/api/v1/lighttick/me/account",
    headers: authorization(accessToken), body: { confirmation: "DELETE" }, requestId: "delete_without_reauth" });
  assert.equal(denied.statusCode, 400);
  assert.equal(denied.body.code, "REQ_FIELD_REQUIRED");

  const wrong = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/reauthentication",
    headers: authorization(accessToken), body: { current_password: "WrongPassword1234" }, requestId: "reauth_wrong" });
  assert.equal(wrong.statusCode, 401);
  const reauthenticated = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/reauthentication",
    headers: authorization(accessToken), body: { current_password: "Password1234" }, requestId: "reauth_ok" });
  assert.equal(reauthenticated.statusCode, 200);
  const proof = (reauthenticated.body.data as any).reauthentication_token;
  assert.ok(proof);

  const deleted = await runtime.app.handle({ method: "DELETE", path: "/api/v1/lighttick/me/account",
    headers: authorization(accessToken), body: { confirmation: "DELETE", reauthentication_token: proof }, requestId: "delete_reauth" });
  assert.equal(deleted.statusCode, 200);
  assert.equal((deleted.body.data as any).sessions_revoked, true);
  assert.equal((deleted.body.data as any).platform_account_retained, true);
  await assert.rejects(runtime.services.authService.consumeReauthenticationProof("lighttick", "user_alice", proof),
    (error: any) => error.code === "LIGHTTICK_REAUTH_REQUIRED");
});

test("LightTick logout revokes the session without deleting product data", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "app_user_alice_lighttick", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-29T00:00:00Z" });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const session = await runtime.services.authService.login({
    appId: "lighttick", account: "alice@example.com", password: "Password1234",
  });
  const goal = await runtime.services.lighttickRuntime.goals.create({ appId: "lighttick", userId: "user_alice" }, {
    title: "Keep after logout", constraints: {},
  });
  const revoked = await runtime.services.authService.logout({ appId: "lighttick", scope: "current",
    refreshToken: session.refreshToken }, runtime.services.tokenService.verifyAccessToken(session.accessToken));
  assert.equal(revoked, 1);
  assert.equal((await runtime.services.lighttickRuntime.goals.get({ appId: "lighttick", userId: "user_alice" }, goal.id)).id, goal.id);
  assert.equal((await runtime.database.findAppUser("lighttick", "user_alice"))?.status, "ACTIVE");
});
