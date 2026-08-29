import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { createApplication } from "../support/create-test-application.ts";

function seed() {
  const value = buildDefaultSeed(undefined, { includeLightTick: true });
  value.appUsers.push({ id: "member_progressive", appId: "lighttick", userId: "user_alice",
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-26T00:00:00Z" });
  return value;
}

async function setup() {
  const runtime = await createApplication({ seed: seed(), lighttickEnabled: true });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  return { runtime, headers: { authorization: `Bearer ${token}`, "x-app-id": "lighttick" },
    owner: { appId: "lighttick", userId: "user_alice" } as LightTickOwner };
}

test("action-first onboarding returns one persisted recommendation and two alternatives without AI", async () => {
  const { runtime, headers, owner } = await setup();
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-starter-001" },
    body: { wish: "我想学编程", timezone: "Asia/Shanghai" }, requestId: "starter" });
  assert.equal(response.statusCode, 201);
  const data = response.body.data as any;
  assert.equal(data.source, "deterministic_template");
  assert.equal(data.alternatives.length, 2);
  assert.ok(data.recommended.estimated_duration_minutes >= 5 && data.recommended.estimated_duration_minutes <= 15);
  assert.deepEqual(Object.keys(data.recommended.variants).sort(), ["light", "minimum", "standard"]);
  assert.equal((await runtime.services.lighttickRuntime.repository.listTasks(owner)).length, 1);

  const replay = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-starter-001" },
    body: { wish: "我想学编程", timezone: "Asia/Shanghai" }, requestId: "starter-replay" });
  assert.deepEqual(replay.body.data, response.body.data);
});

test("first action returns facts and three days without claiming a stable preference", async () => {
  const { runtime, headers } = await setup();
  const starter = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-first-starter" },
    body: { wish: "我想开始跑步", timezone: "UTC" }, requestId: "starter" });
  const task = (starter.body.data as any).recommended;
  const completed = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/first-action",
    headers: { ...headers, "idempotency-key": "progressive-first-action" },
    body: { task_id: task.id, base_version: task.version, selected_variant: "minimum", actual_duration_minutes: 4,
      difficulty: "easy" }, requestId: "first-action" });
  assert.equal(completed.statusCode, 200);
  const data = completed.body.data as any;
  assert.equal(data.feedback.actual_duration_minutes, 4);
  assert.equal(data.feedback.stable_inference, null);
  assert.equal(data.three_day_preview.length, 3);
  assert.equal(data.weekly_commitment.eligible, false);
});

test("task variants preserve lineage and completed tasks cannot switch", async () => {
  const { runtime, headers } = await setup();
  const starter = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-variant-starter" },
    body: { wish: "我想学英语", timezone: "UTC" }, requestId: "starter" });
  const task = (starter.body.data as any).recommended;
  const switched = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/variant`,
    headers: { ...headers, "idempotency-key": "progressive-variant-light" },
    body: { base_version: task.version, variant: "light" }, requestId: "variant" });
  assert.equal(switched.statusCode, 200);
  assert.equal((switched.body.data as any).lineage_id, task.lineage_id);
  assert.equal((switched.body.data as any).selected_variant, "light");
  const completed = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/complete`,
    headers: { ...headers, "idempotency-key": "progressive-variant-complete" },
    body: { base_version: (switched.body.data as any).version, actual_duration_minutes: 6 }, requestId: "complete" });
  const rejected = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/variant`,
    headers: { ...headers, "idempotency-key": "progressive-variant-after-complete" },
    body: { base_version: (completed.body.data as any).version, variant: "minimum" }, requestId: "variant-rejected" });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.code, "LIGHTTICK_STATE_TRANSITION_INVALID");
});

test("pause metadata and recovery mode suppress the normal Today pressure", async () => {
  const { runtime, headers } = await setup();
  const starter = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-pause-starter" },
    body: { wish: "我想写作", timezone: "UTC" }, requestId: "starter" });
  const goal = (starter.body.data as any).goal;
  const paused = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/goals/${goal.id}/lifecycle`,
    headers: { ...headers, "idempotency-key": "progressive-pause-goal" },
    body: { base_version: goal.version, action: "pause", reason: "travel", keep_light_tasks: false,
      notification_policy: "suppress", expected_resume_at: "2026-09-02T00:00:00.000Z" }, requestId: "pause" });
  assert.equal((paused.body.data as any).pause_metadata.reason, "travel");
  const today = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/today", headers, requestId: "today" });
  assert.equal((today.body.data as any).empty_state_action, "resume_goal");
  assert.equal((today.body.data as any).tasks.length, 0);
  const resumed = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/goals/${goal.id}/lifecycle`,
    headers: { ...headers, "idempotency-key": "progressive-recover-goal" },
    body: { base_version: (paused.body.data as any).version, action: "resume", resume_mode: "recovery_mode" }, requestId: "resume" });
  assert.equal((resumed.body.data as any).status, "recovering");
});

test("a recovery completion records effective return only after a three-day interruption", async () => {
  const { runtime, headers, owner } = await setup(); const repository = runtime.services.lighttickRuntime.repository;
  const starter = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding/starter",
    headers: { ...headers, "idempotency-key": "progressive-return-starter" },
    body: { wish: "我想恢复学习", timezone: "UTC" }, requestId: "starter" });
  const data = starter.body.data as any; const goal = await repository.getGoal(owner, data.goal.id); assert.ok(goal);
  const now = new Date(); const pausedAt = new Date(now.getTime() - 4 * 86_400_000).toISOString();
  const recoveryStartedAt = new Date(now.getTime() - 60_000).toISOString();
  await repository.saveGoal({ ...goal!, status: "recovering", pauseMetadata: { reason: "illness", pausedAt,
    keepLightTasks: true, notificationPolicy: "light_only" }, recoveryStartedAt, updatedAt: now.toISOString() }, {
    event: { ...owner, id: "event_recovery_fixture", aggregateType: "goal", aggregateId: goal!.id,
      eventType: "goal_recovery_started", aggregateVersion: goal!.version + 1, payload: {},
      occurredAt: now.toISOString(), createdAt: now.toISOString() },
    change: { ...owner, entityType: "goal", entityId: goal!.id, entityVersion: goal!.version + 1,
      operation: "upsert", snapshot: { status: "recovering" }, changedAt: now.toISOString() },
  }, goal!.version);
  const task = data.recommended;
  const completed = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/complete`,
    headers: { ...headers, "idempotency-key": "progressive-effective-return" },
    body: { base_version: task.version, actual_duration_minutes: 6 }, requestId: "return" });
  assert.equal(completed.statusCode, 200);
  const events = await repository.listExecutionEvents(owner);
  assert.equal(events.filter(event => event.eventType === "effective_return").length, 1);
});

test("legacy plan-first onboarding remains available", async () => {
  const { runtime, headers } = await setup();
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding",
    headers: { ...headers, "idempotency-key": "legacy-onboarding-still-works" }, body: { title: "Legacy path",
      current_level: "beginner", weekly_available_minutes: 120, pace: "balanced", timezone: "UTC" }, requestId: "legacy" });
  assert.equal(response.statusCode, 202);
});
