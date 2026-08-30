import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { createApplication } from "../support/create-test-application.ts";

function runtimeSeed() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({ id: `member_${userId}`,
    appId: "lighttick", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-08-20T00:00:00Z" });
  return seed;
}

async function setup() {
  const runtime = await createApplication({ seed: runtimeSeed(), lighttickEnabled: true });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const headers = { authorization: `Bearer ${token}`, "x-app-id": "lighttick" };
  return { runtime, headers, owner: { appId: "lighttick", userId: "user_alice" } as LightTickOwner };
}

test("profile/onboarding API persists a replayable run and validates timezone", async () => {
  const { runtime, headers } = await setup();
  const request = { method: "POST", path: "/api/v1/lighttick/onboarding", headers: { ...headers, "idempotency-key": "onboard-alice-001" },
    body: { title: "Ship my product", current_level: "prototype", weekly_available_minutes: 300,
      pace: "balanced", timezone: "Asia/Shanghai" }, requestId: "onboarding" };
  const accepted = await runtime.app.handle(request);
  assert.equal(accepted.statusCode, 202); assert.equal(accepted.body.code, "ACCEPTED");
  assert.equal((accepted.body.data as any).status, "queued");
  const replay = await runtime.app.handle({ ...request, requestId: "onboarding-replay" });
  assert.deepEqual(replay.body.data, accepted.body.data);
  const mismatch = await runtime.app.handle({ ...request, body: { ...request.body, timezone: "UTC" }, requestId: "mismatch" });
  assert.equal(mismatch.statusCode, 409); assert.equal(mismatch.body.code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  const run = await runtime.app.handle({ method: "GET", path: `/api/v1/lighttick/runs/${(accepted.body.data as any).id}`,
    headers, requestId: "run" });
  assert.equal(run.statusCode, 200); assert.equal((run.body.data as any).kind, "onboarding_plan");
  assert.equal((runtime.queue as any).jobs.filter((job: any) => job.name === "lighttick.ai.run").length, 1);
  await runtime.queue.processDueJobs(job => runtime.services.lighttickRuntime.worker!.process(job), new Date("2030-01-01"));
  const completedRun = await runtime.app.handle({ method: "GET", path: `/api/v1/lighttick/runs/${(accepted.body.data as any).id}`,
    headers, requestId: "run-completed" });
  assert.equal((completedRun.body.data as any).status, "succeeded");
  const invalid = await runtime.app.handle({ ...request, headers: { ...headers, "idempotency-key": "onboard-invalid-001" },
    body: { ...request.body, timezone: "Mars/Olympus" }, requestId: "invalid" });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.body.code, "LIGHTTICK_TIMEZONE_INVALID");
});

test("device registration and notification preferences are app scoped and validated", async () => {
  const { runtime, headers, owner } = await setup();
  await runtime.services.lighttickRuntime.profile.submitOnboarding(owner, { title: "Ship", currentLevel: "MVP",
    weeklyAvailableMinutes: 120, pace: "balanced", timezone: "Asia/Shanghai" });
  const profile = await runtime.services.lighttickRuntime.profile.getProfile(owner);
  const preferences = await runtime.app.handle({ method: "PATCH", path: "/api/v1/lighttick/profile", headers,
    body: { base_version: profile!.version, notification_preferences: { enabled: true,
      quiet_hours_start: "22:00", quiet_hours_end: "07:00" } }, requestId: "preferences" });
  assert.equal(preferences.statusCode, 200);
  const register = { method: "POST", path: "/api/v1/lighttick/devices",
    headers: { ...headers, "idempotency-key": "device-register-001" }, body: { device_id: "device-ios-001",
      platform: "ios", push_provider: "apns", push_token: "push-token-1234567890", timezone: "Asia/Shanghai",
      locale: "zh-CN", app_version: "1.0.0", notifications_enabled: true }, requestId: "device" };
  const created = await runtime.app.handle(register); const replay = await runtime.app.handle({ ...register, requestId: "device-replay" });
  assert.equal(created.statusCode, 200); assert.deepEqual(replay.body.data, created.body.data);
  assert.equal((await runtime.services.lighttickRuntime.repository.listDevices(owner)).length, 1);
  const invalid = await runtime.app.handle({ ...register, headers: { ...headers, "idempotency-key": "device-invalid-001" },
    body: { ...register.body, platform: "android", push_provider: "apns" }, requestId: "device-invalid" });
  assert.equal(invalid.statusCode, 400);
  const removed = await runtime.app.handle({ method: "DELETE", path: "/api/v1/lighttick/devices/device-ios-001",
    headers, requestId: "device-delete" });
  assert.equal((removed.body.data as any).active, false);
});

test("goal API enforces owner scope, lifecycle versions, envelopes, and idempotency", async () => {
  const { runtime, headers, owner } = await setup();
  const createRequest = { method: "POST", path: "/api/v1/lighttick/goals", headers: { ...headers, "idempotency-key": "goal-create-001" },
    body: { title: "Learn Swift", constraints: { weekly_available_minutes: 240, pace: "balanced" } }, requestId: "goal-create" };
  const created = await runtime.app.handle(createRequest); assert.equal(created.statusCode, 201);
  const goal = created.body.data as any; assert.equal(goal.version, 1); assert.ok(created.body.requestId);
  const replay = await runtime.app.handle({ ...createRequest, requestId: "goal-replay" });
  assert.equal((replay.body.data as any).id, goal.id);
  const stale = await runtime.app.handle({ method: "PATCH", path: `/api/v1/lighttick/goals/${goal.id}`,
    headers: { ...headers, "idempotency-key": "goal-update-stale" }, body: { base_version: 9, title: "Wrong" }, requestId: "stale" });
  assert.equal(stale.statusCode, 409); assert.equal(stale.body.code, "LIGHTTICK_VERSION_CONFLICT");
  const activated = await runtime.services.lighttickRuntime.plans.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-17", periodEnd: "2026-08-23", source: "template",
    tasks: [{ title: "Build screen", estimatedMinutes: 45, scheduledFor: "2026-08-20T04:00:00.000Z" }] });
  await runtime.services.lighttickRuntime.plans.confirm(owner, activated.id, 1);
  const paused = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/goals/${goal.id}/lifecycle`,
    headers: { ...headers, "idempotency-key": "goal-pause-001" }, body: { base_version: 2, action: "pause" }, requestId: "pause" });
  assert.equal(paused.statusCode, 200); assert.equal((paused.body.data as any).status, "paused");
  const bobToken = runtime.services.tokenService.issueAccessToken("user_bob", "lighttick");
  const hidden = await runtime.app.handle({ method: "GET", path: `/api/v1/lighttick/goals/${goal.id}`,
    headers: { authorization: `Bearer ${bobToken}`, "x-app-id": "lighttick" }, requestId: "hidden" });
  assert.equal(hidden.statusCode, 404);
});

test("plan confirmation, Today, and task commands expose deterministic state changes", async () => {
  const { runtime, headers, owner } = await setup(); const services = runtime.services.lighttickRuntime;
  await services.profile.submitOnboarding(owner, { title: "Launch", currentLevel: "MVP", weeklyAvailableMinutes: 300,
    pace: "balanced", timezone: "UTC" });
  const goal = (await services.goals.list(owner))[0]!;
  const plan = await services.plans.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-17", periodEnd: "2026-08-23", source: "template",
    tasks: [{ title: "Primary", estimatedMinutes: 90, priority: 10 }, { title: "Backup", estimatedMinutes: 30, priority: 5 }] });
  const confirmed = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/plans/${plan.id}/confirm`,
    headers: { ...headers, "idempotency-key": "plan-confirm-001" }, body: { base_version: 1 }, requestId: "confirm" });
  assert.equal((confirmed.body.data as any).status, "active");
  const journeyPlans = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/plans",
    query: { goal_id: goal.id }, headers, requestId: "journey-plans" });
  assert.equal(journeyPlans.statusCode, 200);
  assert.equal((journeyPlans.body.data as any).items[0].id, plan.id);
  assert.deepEqual((journeyPlans.body.data as any).items[0].proposal.tasks.map((item: any) => item.title), ["Primary", "Backup"]);
  const plannedTask = (confirmed.body.data as any).tasks[0];
  await services.repository.saveTaskStep({ ...owner, id: "step_primary_open", taskId: plannedTask.id,
    title: "Open the project", position: 0, completed: false, version: 1,
    createdAt: "2026-08-20T08:00:00.000Z", updatedAt: "2026-08-20T08:00:00.000Z" });
  const today = await runtime.app.handle({ method: "GET", path: "/api/v1/lighttick/today", headers, requestId: "today" });
  assert.equal((today.body.data as any).plan_b_available, true);
  const task = (today.body.data as any).primary_task;
  assert.deepEqual(task.steps, [{ id: "step_primary_open", title: "Open the project", completed: false, position: 0 }]);
  const stepped = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/steps/step_primary_open`,
    headers: { ...headers, "idempotency-key": "task-step-001" }, body: { base_version: task.version, completed: true },
    requestId: "step" });
  assert.equal((stepped.body.data as any).steps[0].completed, true);
  assert.equal((stepped.body.data as any).version, task.version + 1);
  const steppedReplay = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/steps/step_primary_open`,
    headers: { ...headers, "idempotency-key": "task-step-001" }, body: { base_version: task.version, completed: true },
    requestId: "step-replay" });
  assert.deepEqual(steppedReplay.body.data, stepped.body.data);
  const completeRequest = { method: "POST", path: `/api/v1/lighttick/tasks/${task.id}/complete`,
    headers: { ...headers, "idempotency-key": "task-complete-001" }, body: { base_version: task.version + 1, actual_duration_minutes: 55 },
    requestId: "complete" };
  const completed = await runtime.app.handle(completeRequest); assert.equal((completed.body.data as any).status, "completed");
  const replay = await runtime.app.handle({ ...completeRequest, requestId: "complete-replay" });
  assert.deepEqual(replay.body.data, completed.body.data);
  const duplicateTerminal = await runtime.app.handle({ ...completeRequest,
    headers: { ...headers, "idempotency-key": "task-complete-002" }, requestId: "duplicate-terminal" });
  assert.equal(duplicateTerminal.statusCode, 409); assert.equal(duplicateTerminal.body.code, "LIGHTTICK_STATE_TRANSITION_INVALID");
});

test("LightTick Admin operations requires a session and exposes aggregates only", async () => {
  const runtime = await createApplication({ seed: runtimeSeed(), lighttickEnabled: true,
    adminBasicAuth: { username: "admin", password: "AdminPass123!" } });
  const denied = await runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/lighttick/operations", headers: {}, requestId: "denied" });
  assert.equal(denied.statusCode, 401);
  const login = await runtime.app.handle({ method: "POST", path: "/api/v1/admin/auth/login", headers: {},
    body: { username: "admin", password: "AdminPass123!" }, requestId: "login" });
  const cookie = login.headers?.["Set-Cookie"]; assert.ok(cookie);
  const response = await runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/lighttick/operations",
    headers: { cookie }, requestId: "operations" });
  assert.equal(response.statusCode, 200); const data = response.body.data as any;
  assert.equal(data.app_id, "lighttick"); assert.equal(data.privacy.private_text_visible, false);
  assert.equal(data.scenes.length, 8); assert.equal("users" in data, false);
  assert.equal(data.metrics.ai_estimated_cost_upper_bound_usd, 0);

  const routing = await runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/lighttick/ai-routing",
    headers: { cookie }, requestId: "routing" });
  assert.equal(routing.statusCode, 200); assert.equal((routing.body.data as any).revision, 1);
  assert.equal((routing.body.data as any).revisions.length, 1);
  assert.match((routing.body.data as any).rawJson, /"onboarding_plan"/);

  const rawJson = JSON.parse((routing.body.data as any).rawJson);
  rawJson.scenes.onboarding_plan.maxEstimatedCostUsd = 0.07;
  await runtime.services.appAiRoutingConfigService.updateConfig("lighttick", JSON.stringify(rawJson), "lower onboarding budget");
  const resolved = await runtime.services.appAiRoutingConfigService.resolveLightTickScene("onboarding_plan");
  assert.equal(resolved.maxEstimatedCostUsd, 0.07);
  const latest = await runtime.app.handle({ method: "GET", path: "/api/v1/admin/apps/lighttick/ai-routing",
    headers: { cookie }, requestId: "routing-latest" });
  assert.equal((latest.body.data as any).revision, 2); assert.equal((latest.body.data as any).revisions.length, 2);

  const ungrantedRestore = await runtime.app.handle({ method: "POST",
    path: "/api/v1/admin/apps/lighttick/ai-routing/revisions/1/restore", headers: { cookie }, body: {}, requestId: "restore" });
  assert.equal(ungrantedRestore.statusCode, 403); assert.equal(ungrantedRestore.body.code, "ADMIN_SENSITIVE_OPERATION_REQUIRED");
});

test("Coach API accepts only bounded scenes and persists a recoverable run", async () => {
  const { runtime, headers, owner } = await setup();
  const goal = await runtime.services.lighttickRuntime.goals.create(owner, { title: "Launch", constraints: {} });
  const accepted = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/coach-runs",
    headers: { ...headers, "idempotency-key": "coach-breakdown-001" },
    body: { scene: "task_breakdown", goal_id: goal.id }, requestId: "coach" });
  assert.equal(accepted.statusCode, 202); assert.equal((accepted.body.data as any).status, "queued");
  const replay = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/coach-runs",
    headers: { ...headers, "idempotency-key": "coach-breakdown-001" },
    body: { scene: "task_breakdown", goal_id: goal.id }, requestId: "coach-replay" });
  assert.deepEqual(replay.body.data, accepted.body.data);
  const invalid = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/coach-runs",
    headers: { ...headers, "idempotency-key": "coach-invalid-001" },
    body: { scene: "free_form_chat", goal_id: goal.id }, requestId: "coach-invalid" });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.body.code, "REQ_FIELD_INVALID");
});
