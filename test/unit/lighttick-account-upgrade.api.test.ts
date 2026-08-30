import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

const DEVICE_SECRET = "fixture-device-secret-at-least-32-characters";
const owner = (userId: string) => ({ appId: "lighttick", userId } as const);
const auth = (token: string) => ({ authorization: `Bearer ${token}`, "x-app-id": "lighttick" });

function seedWithRegisteredTarget() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "app_user_alice_lighttick", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-29T00:00:00.000Z" });
  return seed;
}

async function createGuest(runtime: Awaited<ReturnType<typeof createApplication>>, suffix: string) {
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/guest-sessions",
    headers: { "idempotency-key": `guest-create-${suffix}` }, requestId: `guest-create-${suffix}`,
    ipAddress: `198.51.100.${suffix.length + 20}`,
    body: { device_id: `device-${suffix}`, device_secret: DEVICE_SECRET, platform: "ios",
      timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0" } });
  assert.equal(response.statusCode, 201);
  return response.body.data as any;
}

test("guest upgrade preserves product identity, target preferences, sync position, and lost-response replay", async () => {
  const runtime = await createApplication({ seed: seedWithRegisteredTarget(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "upgrade-001");
  const guestHeaders = { ...auth(guest.access_token), "idempotency-key": "starter-upgrade-001" };
  const starter = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: guestHeaders, requestId: "starter-upgrade-001",
    body: { wish: "完成一个稳定目标", timezone: "Asia/Shanghai" } });
  assert.equal(starter.statusCode, 201);
  const goalId = (starter.body.data as any).goal.id;

  await runtime.services.lighttickRuntime.repository.saveProfile({ ...owner("user_alice"), timezone: "Europe/Paris",
    locale: "fr-FR", pace: "relaxed", onboardingState: "not_started",
    notificationPreferences: { quiet: true }, onboardingDraft: { formal: true }, version: 1,
    createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" });
  const formalToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const request = { method: "POST", path: "/api/v1/lighttick/account/upgrade",
    headers: { ...auth(formalToken), "idempotency-key": "upgrade-operation-001" }, requestId: "upgrade-001",
    body: { guest_user_id: guest.user_id, guest_upgrade_token: guest.upgrade_token, device_id: guest.device_id } };
  const upgraded = await runtime.app.handle(request);
  assert.equal(upgraded.statusCode, 200);
  assert.equal((upgraded.body.data as any).idempotency_replayed, false);
  assert.equal((upgraded.body.data as any).transferred_resource_counts.goals, 1);
  assert.ok((upgraded.body.data as any).sync_cursor);
  assert.equal((await runtime.services.lighttickRuntime.repository.getGoal(owner("user_alice"), goalId))?.id, goalId);
  const profile = await runtime.services.lighttickRuntime.repository.getProfile(owner("user_alice"));
  assert.equal(profile?.timezone, "Europe/Paris");
  assert.deepEqual(profile?.notificationPreferences, { quiet: true });
  assert.equal(profile?.onboardingState, "starter_ready");
  assert.deepEqual(profile?.onboardingDraft, { formal: true });
  assert.equal((await runtime.database.findAppUser("lighttick", guest.user_id))?.status, "DELETED");

  const replayed = await runtime.app.handle(request);
  assert.equal(replayed.statusCode, 200);
  assert.equal((replayed.body.data as any).idempotency_replayed, true);
  assert.equal((await runtime.services.lighttickRuntime.repository.listGoals(owner("user_alice"))).length, 1);
  const guestDenied = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/account/session",
    headers: auth(guest.access_token), requestId: "guest-after-upgrade" });
  assert.equal(guestDenied.statusCode, 401);
});

test("guest upgrade rejects stolen proof and idempotency-key request changes", async () => {
  const runtime = await createApplication({ seed: seedWithRegisteredTarget(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "security-001");
  const formalToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const base = { method: "POST", path: "/api/v1/lighttick/account/upgrade",
    headers: { ...auth(formalToken), "idempotency-key": "upgrade-operation-security" }, requestId: "upgrade-security",
    body: { guest_user_id: guest.user_id, guest_upgrade_token: `${guest.upgrade_token}wrong`, device_id: guest.device_id } };
  const stolen = await runtime.app.handle(base);
  assert.equal(stolen.statusCode, 401);
  assert.equal(stolen.body.code, "LIGHTTICK_GUEST_CREDENTIAL_INVALID");

  (base.body as any).guest_upgrade_token = guest.upgrade_token;
  assert.equal((await runtime.app.handle(base)).statusCode, 200);
  (base.body as any).device_id = "another-device";
  const mismatch = await runtime.app.handle(base);
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.body.code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
});

test("guest upgrade rolls back conflicting idempotent operations", async () => {
  const runtime = await createApplication({ seed: seedWithRegisteredTarget(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "conflict-001");
  const repository = runtime.services.lighttickRuntime.repository;
  const timestamp = "2026-08-29T00:00:00.000Z";
  await repository.saveOperation({ ...owner(guest.user_id), operationId: "shared-operation", deviceId: guest.device_id,
    payloadHash: "guest-hash", entityType: "task", entityId: "task-a", action: "complete",
    requestPayload: {}, resultPayload: { status: "accepted" }, status: "accepted", createdAt: timestamp, updatedAt: timestamp });
  await repository.saveOperation({ ...owner("user_alice"), operationId: "shared-operation", deviceId: "formal-device",
    payloadHash: "formal-hash", entityType: "task", entityId: "task-a", action: "complete",
    requestPayload: {}, resultPayload: { status: "accepted" }, status: "accepted", createdAt: timestamp, updatedAt: timestamp });
  const formalToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/upgrade",
    headers: { ...auth(formalToken), "idempotency-key": "upgrade-operation-conflict" }, requestId: "upgrade-conflict",
    body: { guest_user_id: guest.user_id, guest_upgrade_token: guest.upgrade_token, device_id: guest.device_id } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "LIGHTTICK_GUEST_UPGRADE_CONFLICT");
  assert.equal((await runtime.database.findAppUser("lighttick", guest.user_id))?.status, "ACTIVE");
  assert.equal((await repository.getGuestIdentity(owner(guest.user_id)))?.revokedAt, undefined);
});

test("guest upgrade deduplicates equivalent operations without duplicating results", async () => {
  const runtime = await createApplication({ seed: seedWithRegisteredTarget(), lighttickEnabled: true });
  const guest = await createGuest(runtime, "duplicate-001");
  const repository = runtime.services.lighttickRuntime.repository;
  const timestamp = "2026-08-29T00:00:00.000Z";
  const operation = { operationId: "equivalent-operation", payloadHash: "same-hash", entityType: "task",
    entityId: "task-a", action: "complete", requestPayload: { stable: true },
    resultPayload: { status: "accepted", nested: { one: 1, two: 2 } }, status: "accepted",
    createdAt: timestamp, updatedAt: timestamp };
  await repository.saveOperation({ ...owner(guest.user_id), ...operation, deviceId: guest.device_id });
  await repository.saveOperation({ ...owner("user_alice"), ...operation, deviceId: "formal-device" });
  const formalToken = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/account/upgrade",
    headers: { ...auth(formalToken), "idempotency-key": "upgrade-operation-duplicate" }, requestId: "upgrade-duplicate",
    body: { guest_user_id: guest.user_id, guest_upgrade_token: guest.upgrade_token, device_id: guest.device_id } });
  assert.equal(response.statusCode, 200);
  assert.equal((await repository.getOperation(owner("user_alice"), operation.operationId))?.payloadHash, "same-hash");
});
