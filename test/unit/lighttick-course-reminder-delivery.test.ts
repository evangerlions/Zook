import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickNotificationService, type LightTickPushPayload } from "../../src/modules/lighttick/lighttick-notifications.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../../src/modules/lighttick/lighttick.types.ts";
import type { PushDispatcher } from "../../src/services/notification.service.ts";
import { sha256 } from "../../src/shared/utils.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "course-reminder-owner" };
const now = "2026-11-22T17:10:00.000Z";
const businessDate = "2026-11-23";
const versioned = { ...owner, version: 1, createdAt: now, updatedAt: now };

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  const queue = new InMemoryJobQueue();
  const goal: LightTickGoalRow = { ...versioned, id: "goal", status: "active", title: "Course", constraints: {} };
  const plan: LightTickPlanRow = {
    ...versioned, id: "plan", goalId: goal.id, status: "active", source: "learning_schedule", granularity: "day",
    periodStart: businessDate, periodEnd: businessDate, proposal: {},
  };
  const task: LightTickTaskRow = {
    ...versioned, id: "task", goalId: goal.id, planId: plan.id, title: "Course title stays private", status: "pending",
    priority: 0, estimatedMinutes: 15, scheduledFor: now,
    lessonSource: { route_id: "route", route_version: 1, lesson_number: 1, lesson_id: "lesson", content_version: "1", purpose: "learn" },
  };
  repository.getGoal = async (scope, id) => scope.userId === owner.userId && id === goal.id ? goal : undefined;
  repository.getPlan = async (scope, id) => scope.userId === owner.userId && id === plan.id ? plan : undefined;
  repository.getTask = async (scope, id) => scope.userId === owner.userId && id === task.id ? task : undefined;
  const profile = { ...versioned, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced" as const,
    onboardingState: "completed", onboardingDraft: {}, notificationPreferences: { enabled: true } as Record<string, unknown> };
  await repository.saveProfile(profile);
  const device = async (id: string) => await repository.upsertDevice({
    ...versioned, id, active: true, platform: "ios", pushProvider: "apns", pushToken: id, notificationsEnabled: true,
    timezone: profile.timezone, locale: profile.locale, appVersion: "1",
  });
  await device("first");
  const reminder: LightTickPushPayload = {
    type: "course_reminder", resource_id: task.id, expected_task_version: 1, title_key: "course_reminder.title", body_key: "course_reminder.body",
  };
  return { repository, queue, profile, goal, plan, task, device, reminder };
}

test("course reminder uses the owner's business date, sends only generic copy, and replays once", async () => {
  const { queue, repository, task, reminder } = await fixture();
  const received: Parameters<PushDispatcher["dispatch"]>[0]["payload"][] = [];
  const service = new LightTickNotificationService(repository, queue, {
    dispatch: async request => { received.push(request.payload); },
  }, undefined, () => new Date(now), undefined, async (scope, verified) => {
    assert.deepEqual(scope, owner);
    assert.deepEqual(verified.lessonSource, task.lessonSource);
    return true;
  });
  await assert.rejects(() => service.enqueue(owner, businessDate, { ...reminder, expected_task_version: undefined }));
  const scheduled = await service.schedule({
    id: "schedule", name: "lighttick.notification.schedule", attemptsMade: 0, maxAttempts: 1, backoffMs: 1, availableAt: now,
    payload: { app_id: owner.appId, user_id: owner.userId, business_date: businessDate, notification_key: "course_reminder",
      resource_id: task.id, expected_task_version: task.version },
  });
  assert.deepEqual(await service.enqueue(owner, businessDate, reminder), scheduled);
  const [job] = queue.jobs;
  assert.ok(job);
  await service.process(job);
  await service.process(job);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0]?.data, {
    type: "course_reminder", resource_id: task.id, sync: "true", recipient_scope: sha256(`lighttick:${owner.userId}`),
    business_date: businessDate, task_version: String(task.version),
  });
  assert.doesNotMatch(JSON.stringify(received), /Course title stays private/);
});

test("stale, unavailable or unapproved course reminders are suppressed", async t => {
  const cases = ["rescheduled", "new version", "completed", "inactive plan", "paused goal", "no opt-in", "missing opt-in",
    "quiet hours", "late", "missing task", "non-course", "coverage denied", "coverage unwired"] as const;
  for (const reason of cases) await t.test(reason, async () => {
    const { queue, repository, profile, goal, plan, task, reminder } = await fixture();
    const service = new LightTickNotificationService(repository, queue, {
      dispatch: async () => assert.fail(`Unexpected dispatch for ${reason}`),
    }, undefined, () => new Date(reason === "late" ? "2026-11-23T17:10:00.000Z" : now),
    undefined, reason === "coverage unwired" ? undefined : async () => reason !== "coverage denied");
    await service.enqueue(owner, businessDate, reminder);
    switch (reason) {
      case "rescheduled": task.scheduledFor = "2026-11-24"; break;
      case "new version": task.version++; break;
      case "completed": task.status = "completed"; break;
      case "inactive plan": plan.status = "superseded"; break;
      case "paused goal": goal.status = "paused"; break;
      case "no opt-in": await repository.saveProfile({ ...profile, notificationPreferences: { enabled: false } }, profile.version); break;
      case "missing opt-in": await repository.saveProfile({ ...profile, notificationPreferences: {} }, profile.version); break;
      case "quiet hours": await repository.saveProfile({ ...profile, notificationPreferences: {
        enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "07:00",
      } }, profile.version); break;
      case "missing task": task.id = "other"; break;
      case "non-course": delete task.lessonSource; break;
    }
    const [job] = queue.jobs;
    assert.ok(job);
    await service.process(job);
  });
});

test("a course reminder retry skips devices whose transport already accepted it", async () => {
  const { queue, repository, device, task, reminder } = await fixture();
  await device("second");
  const attempted: string[] = [];
  const service = new LightTickNotificationService(repository, queue, {
    dispatch: async request => {
      attempted.push(request.pushToken);
      if (attempted.length === 2) throw new Error("Transient transport failure");
    },
  }, undefined, () => new Date(now), undefined, async () => true);
  await service.enqueue(owner, businessDate, reminder);
  const [job] = queue.jobs;
  assert.ok(job);
  await assert.rejects(() => service.process(job), /Transient transport failure/);
  await service.process(job);
  task.version++;
  await service.enqueue(owner, businessDate, { ...reminder, expected_task_version: task.version });
  const revisedJob = queue.jobs.at(-1);
  assert.ok(revisedJob && revisedJob.id !== job.id);
  await service.process(revisedJob);
  assert.deepEqual(attempted, ["first", "second", "second"]);
});
