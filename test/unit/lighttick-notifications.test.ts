import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickNotificationService, lightTickAnalyticsPayload, redactLightTickLog } from "../../src/modules/lighttick/lighttick-notifications.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "notify_user" }; const now = "2026-08-20T00:00:00.000Z";
async function device(repository: InMemoryLightTickRepository, id: string, token: string) {
  return await repository.upsertDevice({ ...owner, id, platform: "ios", pushProvider: "apns", pushToken: token,
    timezone: "Asia/Shanghai", locale: "zh-CN", appVersion: "1.0", notificationsEnabled: true, active: true,
    createdAt: now, updatedAt: now });
}

test("notification worker handles no device, multiple devices, and duplicate scheduler ticks", async () => {
  const repository = new InMemoryLightTickRepository(); const queue = new InMemoryJobQueue(); const sent: string[] = [];
  const service = new LightTickNotificationService(repository, queue, { dispatch: async request => { sent.push(request.pushToken); } }, undefined, () => new Date(now));
  const payload = { type: "daily_tasks" as const, title_key: "daily.title", body_key: "daily.body" };
  const first = await service.enqueue(owner, "2026-08-20", payload); const duplicate = await service.enqueue(owner, "2026-08-20", payload);
  assert.deepEqual(duplicate, first); assert.equal(queue.jobs.length, 1);
  await queue.processDueJobs(job => service.process(job), new Date("2030-01-01")); assert.equal(sent.length, 0);
  await device(repository, "device_one_001", "push_token_one_123456"); await device(repository, "device_two_001", "push_token_two_123456");
  await service.enqueue(owner, "2026-08-21", payload); await queue.processDueJobs(job => service.process(job), new Date("2030-01-01"));
  assert.deepEqual(sent.sort(), ["push_token_one_123456", "push_token_two_123456"]);
});

test("invalid tokens are disabled while transient delivery failures retry", async () => {
  const repository = new InMemoryLightTickRepository(); const queue = new InMemoryJobQueue();
  await device(repository, "device_invalid_001", "push_token_bad_123456");
  const invalid = new LightTickNotificationService(repository, queue, { dispatch: async () => { throw new Error("Unregistered token"); } }, undefined, () => new Date(now));
  await invalid.enqueue(owner, "2026-08-20", { type: "recovery", title_key: "a", body_key: "b" });
  await queue.processDueJobs(job => invalid.process(job), new Date("2030-01-01"));
  assert.equal((await repository.listDevices(owner))[0]?.active, false); assert.equal(queue.jobs.length, 0);
  await device(repository, "device_retry_001", "push_token_retry_123456"); let attempts = 0;
  const retrying = new LightTickNotificationService(repository, queue, { dispatch: async () => { attempts++; throw new Error("network"); } });
  await retrying.enqueue(owner, "2026-08-21", { type: "recovery", title_key: "a", body_key: "b" });
  await queue.processDueJobs(job => retrying.process(job), new Date("2030-01-01")); assert.equal(attempts, 1); assert.equal(queue.jobs.length, 1);
});

test("enqueue failure is recoverable, cross-app jobs are rejected, and telemetry is redacted", async () => {
  const repository = new InMemoryLightTickRepository(); const queue = new InMemoryJobQueue(); const failed: any[] = [];
  queue.markNextAddAsFailure(); const service = new LightTickNotificationService(repository, queue, { dispatch: async () => undefined },
    async payload => { failed.push(payload); });
  assert.deepEqual(await service.enqueue(owner, "2026-08-20", { type: "review_ready", title_key: "a", body_key: "b" }), { queued: false });
  assert.equal(failed.length, 1);
  await assert.rejects(() => service.process({ id: "job_cross", name: "lighttick.notification.send", payload: { app_id: "other",
    user_id: owner.userId, notification: {} }, attemptsMade: 0, maxAttempts: 1, backoffMs: 1, availableAt: now }));
  assert.deepEqual(lightTickAnalyticsPayload("lighttick_task_completed", { duration: 20, note: "secret", push_token: "secret" }), { duration: 20 });
  assert.deepEqual(redactLightTickLog({ request_id: "r1", authorization: "Bearer secret", prompt: "private" }),
    { request_id: "r1", authorization: "[REDACTED]", prompt: "[REDACTED]" });
});

test("notification preferences and overnight quiet hours suppress delivery", async () => {
  const repository = new InMemoryLightTickRepository(); const queue = new InMemoryJobQueue(); let sent = 0;
  await device(repository, "device_quiet_001", "push_token_quiet_123456");
  await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
    onboardingState: "completed", notificationPreferences: { enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "07:00" },
    onboardingDraft: {}, version: 1, createdAt: now, updatedAt: now });
  const service = new LightTickNotificationService(repository, queue, { dispatch: async () => { sent++; } }, undefined,
    () => new Date("2026-08-20T15:00:00Z"));
  await service.enqueue(owner, "2026-08-20", { type: "unfinished_task", title_key: "a", body_key: "b" });
  await queue.processDueJobs(job => service.process(job), new Date("2030-01-01")); assert.equal(sent, 0);
});
