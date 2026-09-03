import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

const DEVICE_SECRET = "fixture-device-secret-at-least-32-characters";

function guestRequest(deviceId: string, key: string, ipAddress = "203.0.113.10") {
  return { method: "POST", path: "/api/v1/lighttick/account/guest-sessions",
    headers: { "idempotency-key": key }, ipAddress, requestId: key,
    body: { device_id: deviceId, device_secret: DEVICE_SECRET, platform: "ios",
      timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0" } };
}

test("guest issuance is device-bound, audited, recoverable, and LightTick-scoped", async () => {
  const runtime = await createApplication({
    seed: buildDefaultSeed(undefined, { includeLightTick: true }), lighttickEnabled: true,
  });
  const first = await runtime.app.handle(guestRequest("device_guest_001", "guest-create-001"));
  assert.equal(first.statusCode, 201);
  const data = first.body.data as any;
  assert.equal(data.account_kind, "guest");
  assert.ok(data.access_token); assert.ok(data.refresh_token); assert.ok(data.upgrade_token);
  const guestUser = await runtime.database.findUserById(data.user_id);
  assert.equal(guestUser?.passwordAlgo, "lighttick-guest");
  assert.equal((await runtime.database.findAppUser("lighttick", data.user_id))?.status, "ACTIVE");
  assert.equal(await runtime.database.findAppUser("app_a", data.user_id), undefined);
  const audit = runtime.database.auditLogs.find(item => item.action === "lighttick.guest.created");
  assert.equal(audit?.appId, "lighttick");
  assert.equal(JSON.stringify(audit?.payload).includes("device_guest_001"), false);

  const headers = { authorization: `Bearer ${data.access_token}`, "x-app-id": "lighttick" };
  const session = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/account/session",
    headers, requestId: "guest-session" });
  assert.equal(session.statusCode, 200); assert.equal((session.body.data as any).account_kind, "guest");
  const profile = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/profile",
    headers, requestId: "guest-profile" });
  assert.equal(profile.statusCode, 200);
  const restricted = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/reviews",
    headers, requestId: "guest-restricted" });
  assert.equal(restricted.statusCode, 403); assert.equal(restricted.body.code, "APP_SCOPE_FORBIDDEN");
  const crossApp = await runtime.app.handle({ method: "GET", path: "/api/v1/users/me",
    headers: { authorization: `Bearer ${data.access_token}`, "x-app-id": "app_a" }, requestId: "guest-cross-app" });
  assert.equal(crossApp.statusCode, 403); assert.equal(crossApp.body.code, "AUTH_APP_SCOPE_MISMATCH");

  const recovered = await runtime.app.handle(guestRequest("device_guest_001", "guest-recover-002"));
  assert.equal(recovered.statusCode, 201);
  assert.equal((recovered.body.data as any).user_id, data.user_id);
  assert.ok(runtime.database.auditLogs.some(item => item.action === "lighttick.guest.recovered"));

  const stolen = guestRequest("device_guest_001", "guest-stolen-003");
  (stolen.body as any).device_secret = "wrong-device-secret-that-is-at-least-32-chars";
  const denied = await runtime.app.handle(stolen);
  assert.equal(denied.statusCode, 401); assert.equal(denied.body.code, "AUTH_TOKEN_INVALID");
});

test("guest issuance rejects idempotency mismatches and rate limits an IP window", async () => {
  const runtime = await createApplication({
    seed: buildDefaultSeed(undefined, { includeLightTick: true }), lighttickEnabled: true,
  });
  const original = guestRequest("device_idempotent_001", "guest-idempotent-001", "198.51.100.20");
  assert.equal((await runtime.app.handle(original)).statusCode, 201);
  const mismatch = structuredClone(original); (mismatch.body as any).locale = "en-US";
  const conflict = await runtime.app.handle(mismatch);
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.body.code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");

  for (let index = 0; index < 5; index++) {
    const response = await runtime.app.handle(guestRequest(`device_rate_00${index}`, `guest-rate-00${index}`, "192.0.2.44"));
    assert.equal(response.statusCode, 201);
  }
  const limited = await runtime.app.handle(guestRequest("device_rate_999", "guest-rate-999", "192.0.2.44"));
  assert.equal(limited.statusCode, 429); assert.equal(limited.body.code, "RATE_LIMITED");
});

test("expired guest identity is rejected even while its access token is otherwise valid", async () => {
  const runtime = await createApplication({
    seed: buildDefaultSeed(undefined, { includeLightTick: true }), lighttickEnabled: true,
  });
  const created = await runtime.app.handle(guestRequest("device_expiry_001", "guest-expiry-001"));
  const userId = (created.body.data as any).user_id;
  await assert.rejects(
    runtime.services.lighttickRuntime.guestIdentity!.getActive(userId, new Date("2100-01-01T00:00:00Z")),
    (error: any) => error.statusCode === 410 && error.code === "LIGHTTICK_GUEST_SESSION_EXPIRED",
  );
});
