import assert from "node:assert/strict";
import test from "node:test";
import { LightTickErrorCodeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

const DEVICE_SECRET = "security-device-secret-at-least-32-characters";
const owner = (userId: string) => ({ appId: "lighttick", userId } as const);
const auth = (token: string, appId = "lighttick") =>
  ({ authorization: `Bearer ${token}`, "x-app-id": appId });

function securitySeed() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({
    id: `app_user_${userId}_lighttick`, appId: "lighttick", userId,
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-29T00:00:00.000Z",
  });
  return seed;
}

async function createGuest(runtime: Awaited<ReturnType<typeof createApplication>>, suffix: string) {
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/guest-sessions",
    headers: { "idempotency-key": `security-guest-${suffix}` }, requestId: `security-guest-${suffix}`,
    ipAddress: `203.0.113.${suffix.length + 30}`,
    body: { device_id: `security-device-${suffix}`, device_secret: DEVICE_SECRET, platform: "android",
      timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0" } });
  assert.equal(response.statusCode, 201);
  return response.body.data as any;
}

function upgradeRequest(token: string, key: string, guest: any) {
  return { method: "POST", path: "/api/v1/lighttick/account/upgrade",
    headers: { ...auth(token), "idempotency-key": key }, requestId: key,
    body: { guest_user_id: guest.user_id, guest_upgrade_token: guest.upgrade_token,
      device_id: guest.device_id } };
}

test("guest upgrade credential failures do not reveal whether the guest identity exists", async () => {
  const runtime = await createApplication({ seed: securitySeed(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "enumeration");
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const existing = upgradeRequest(token, "enumeration-existing", guest);
  (existing.body as any).guest_upgrade_token = `${guest.upgrade_token}-wrong`;
  const missing = upgradeRequest(token, "enumeration-missing", {
    user_id: "lighttick_guest_missing", upgrade_token: "missing-proof", device_id: guest.device_id,
  });

  const [existingResponse, missingResponse] = await Promise.all([
    runtime.app.handle(existing), runtime.app.handle(missing),
  ]);
  assert.equal(existingResponse.statusCode, 401);
  assert.equal(missingResponse.statusCode, 401);
  assert.equal(existingResponse.body.code, "LIGHTTICK_GUEST_CREDENTIAL_INVALID");
  assert.equal(missingResponse.body.code, existingResponse.body.code);
  assert.equal(missingResponse.body.message, existingResponse.body.message);
});

test("guest upgrade rejects expired, revoked, guest-target, and cross-app credentials without mutation", async () => {
  const runtime = await createApplication({ seed: securitySeed(), lighttickEnabled: true });
  const targetToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");

  const expired = await createGuest(runtime, "expired");
  const expiredRow = await runtime.services.lighttickRuntime.repository.getGuestIdentity(owner(expired.user_id));
  assert.ok(expiredRow);
  await runtime.services.lighttickRuntime.repository.saveGuestIdentity({ ...expiredRow,
    expiresAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" });
  const expiredResponse = await runtime.app.handle(upgradeRequest(targetToken, "upgrade-expired", expired));
  assert.equal(expiredResponse.statusCode, 410);
  assert.equal(expiredResponse.body.code, "LIGHTTICK_GUEST_EXPIRED");

  const revoked = await createGuest(runtime, "revoked");
  const revokedRow = await runtime.services.lighttickRuntime.repository.getGuestIdentity(owner(revoked.user_id));
  assert.ok(revokedRow);
  await runtime.services.lighttickRuntime.repository.saveGuestIdentity({ ...revokedRow,
    revokedAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" });
  const revokedResponse = await runtime.app.handle(upgradeRequest(targetToken, "upgrade-revoked", revoked));
  assert.equal(revokedResponse.statusCode, 410);
  assert.equal(revokedResponse.body.code, "LIGHTTICK_GUEST_REVOKED");

  const source = await createGuest(runtime, "guest-source");
  const guestTarget = await createGuest(runtime, "guest-target");
  const guestTargetResponse = await runtime.app.handle(
    upgradeRequest(guestTarget.access_token, "upgrade-to-guest", source));
  assert.equal(guestTargetResponse.statusCode, 403);
  assert.equal(guestTargetResponse.body.code, "LIGHTTICK_APP_ACCESS_DENIED");

  const foreignToken = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");
  const crossApp = upgradeRequest(foreignToken, "upgrade-cross-app", source);
  crossApp.headers = { ...auth(foreignToken, "app_a"), "idempotency-key": "upgrade-cross-app" };
  const crossAppResponse = await runtime.app.handle(crossApp);
  assert.equal(crossAppResponse.statusCode, 403);
  assert.equal(await runtime.services.lighttickRuntime.repository.getGuestIdentity(owner(source.user_id))
    .then(row => row?.revokedAt), undefined);
});

test("a completed upgrade operation cannot be stolen by a different registered account", async () => {
  const runtime = await createApplication({ seed: securitySeed(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "stolen-operation");
  const aliceToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const bobToken = runtime.services.tokenService.issueAccessToken("user_bob", "lighttick");
  const key = "upgrade-operation-owner-bound";
  assert.equal((await runtime.app.handle(upgradeRequest(aliceToken, key, guest))).statusCode, 200);

  const stolen = await runtime.app.handle(upgradeRequest(bobToken, key, guest));
  assert.equal(stolen.statusCode, 409);
  assert.equal(stolen.body.code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  assert.equal((await runtime.database.findAppUser("lighttick", "user_bob"))?.status, "ACTIVE");
  assert.equal((await runtime.services.lighttickRuntime.repository.listGoals(owner("user_bob"))).length, 0);
});

test("the generated LightTick error contract includes every account security outcome", () => {
  const values = (LightTickErrorCodeSchema as { enum: string[] }).enum;
  for (const code of ["LIGHTTICK_GUEST_CREDENTIAL_INVALID", "LIGHTTICK_GUEST_EXPIRED",
    "LIGHTTICK_GUEST_REVOKED", "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
    "LIGHTTICK_IDEMPOTENCY_MISMATCH", "LIGHTTICK_REAUTH_REQUIRED", "LIGHTTICK_APP_ACCESS_DENIED"])
    assert.ok(values.includes(code), code);
});
