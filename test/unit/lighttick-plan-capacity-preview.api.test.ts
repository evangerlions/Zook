import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningCapacityPreviewEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { ManualAction, ManualDraft } from "../../src/modules/lighttick/manual/manual-planning.types.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-29T16:30:00Z");
const stamps = { createdAt: now.toISOString(), updatedAt: now.toISOString() };
const start = "2026-11-30", end = "2026-12-06";

function action(id: string, minutes: number | null, date: string | null = start): ManualAction {
  return { id, title: id, scheduled_for: date, estimated_minutes: minutes, completion_criteria: "Done", guidance: "" };
}

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "preview-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: stamps.createdAt,
  });
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    options: { query?: HttpRequest["query"]; caller?: string; unauthenticated?: boolean } = {}) {
    const response = await app.handle({ path: "/api/v1/lighttick/" + path, method, query: options.query ?? {}, body, headers: {
      ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.caller ?? owner.userId, appId) }),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": "weekly-preview-" + (++sequence),
    } });
    return { ...response, envelope: response.body as { data: any; code: string } };
  }
  async function save(path: string, method: HttpRequest["method"], body: HttpRequest["body"]) {
    const result = await call(path, method, body);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    return result.envelope.data;
  }
  const draft = (tasks: ManualAction[], fields: Partial<ManualDraft> = {}) => save("manual-plans", "POST", {
    title: "Reviewed plan", completion_criteria: "One concrete result", period_start: start, period_end: end, tasks, ...fields,
  });
  const confirm = (plan: { id: string; version: number; goal_version: number }) =>
    call("manual-plans/" + plan.id + "/confirm", "POST", { base_version: plan.version, goal_base_version: plan.goal_version });
  const budget = (weekly_available_minutes: number) => save("planning-capacity", "PATCH", {
    base_version: 0, weekly_available_minutes, plan_percent: 100,
  });
  const preview = (planId: string, version: number, caller?: string) => call("planning-capacity/preview", "GET", undefined, {
    caller, query: { plan_id: planId, plan_version: String(version) },
  });
  await save("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" });
  return { call, save, draft, confirm, budget, preview, repository, runtime };
}

test("saved manual capacity projects shared work, completion time and missing estimates across business weeks", async () => {
  const { call, save, draft, confirm, budget, preview, repository } = await fixture();
  const occupied = await confirm(await draft([action("Known confirmed work", 35), action("Unknown confirmed work", null)]));
  assert.equal(occupied.statusCode, 200, JSON.stringify(occupied.body));
  const completed = occupied.envelope.data.tasks[0];
  await save("tasks/" + completed.id + "/complete", "POST", { base_version: completed.version, actual_duration_minutes: 28 });
  await budget(40);
  const proposed = await draft([action("First dated addition", 20), action("Second week unknown", null, "2026-12-08"),
    action("Unscheduled note", 5, null)], { period_end: "2026-12-08" });
  const before = await repository.pullChanges(owner, 0, 100);
  const response = await preview(proposed.id, proposed.version);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningCapacityPreviewEnvelopeSchema);
  assert.equal(validate(response.body), true, JSON.stringify(validate.errors));
  assert.deepEqual(response.envelope.data, { plan_id: proposed.id, plan_version: proposed.version,
    business_date: start, timezone: "Asia/Shanghai", undated_action_count: 1, block_reason: "missing_estimate", weeks: [{
      starts_on: start, ends_on: end, scope: "account", limit_minutes: 40,
      current_minutes: 28, retained_minutes: 28, proposed_minutes: 20, projected_minutes: 48, shortfall_minutes: 8,
      unknown_scheduled_count: 1, unknown_proposed_count: 0, unknown_completed_count: 0, blocking: "missing_estimate",
    }, {
      starts_on: "2026-12-07", ends_on: "2026-12-13", scope: "account", limit_minutes: 40,
      current_minutes: 0, retained_minutes: 0, proposed_minutes: 0, projected_minutes: 0, shortfall_minutes: 0,
      unknown_scheduled_count: 0, unknown_proposed_count: 1, unknown_completed_count: 0, blocking: "missing_estimate",
    }] });
  assert.deepEqual(await repository.pullChanges(owner, 0, 100), before);
  assert.equal((await preview(proposed.id, proposed.version + 1)).statusCode, 409);
  assert.equal((await preview(proposed.id, proposed.version, "user_bob")).statusCode, 404);
  assert.equal((await preview("missing-plan", proposed.version)).statusCode, 404);
  assert.equal((await call("planning-capacity/preview", "GET", undefined, { unauthenticated: true })).statusCode, 401);
  assert.equal((await call("planning-capacity/preview", "GET", undefined,
    { query: { plan_id: proposed.id, plan_version: "1e2" } })).statusCode, 400);
});

test("manual preview subtracts only reviewed replacement work and rejects a stale source or a date beyond the goal deadline", async () => {
  const { save, draft, confirm, budget, preview, repository, runtime } = await fixture();
  const existing = await confirm(await draft([action("Original task to be replaced", 35)]));
  assert.equal(existing.statusCode, 200, JSON.stringify(existing.body));
  const original = existing.envelope.data.tasks[0];
  await budget(40);
  const proposed = await draft([action("Reviewed replacement", 25)], {
    goal_id: existing.envelope.data.goal_id, replace_tasks: [{ id: original.id, version: original.version }],
  });
  const result = await preview(proposed.id, proposed.version);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const week = result.envelope.data.weeks[0];
  assert.deepEqual([week.current_minutes, week.retained_minutes, week.proposed_minutes, week.projected_minutes, week.blocking],
    [35, 0, 25, 25, null]);
  assert.equal((await repository.getTask(owner, original.id))?.status, "pending");
  await save("tasks/" + original.id + "/complete", "POST", { base_version: original.version, actual_duration_minutes: 12 });
  const stale = await preview(proposed.id, proposed.version);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.envelope.code, "LIGHTTICK_VERSION_CONFLICT");
  const fixed = await runtime.goals.create(owner, { title: "A goal with a fixed deadline", targetDate: start, constraints: {} });
  const overDeadline = await draft([action("Later dated task", 10, "2026-12-03")], { goal_id: fixed.id });
  assert.equal((await preview(overDeadline.id, overDeadline.version)).envelope.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
});

test("only the live conversational proposal can preview a subject budget and required action dates", async () => {
  const { save, budget, preview, repository, runtime } = await fixture();
  const goal = await runtime.goals.create(owner, { title: "One learning goal", constraints: {} });
  await budget(80);
  await save("goals/" + goal.id + "/subjects", "PATCH", { base_version: 0, subjects: [{
    id: "read", title: "Reading", outcome_criteria: "Explain a passage", priority: "high", weekly_minutes: 15, archived: false,
  }] });
  const service = new LightTickPlanningService(repository, () => now);
  const planService = new LightTickPlanService(repository, () => now);
  const sessionId = "preview-live-session";
  const input = { goalId: goal.id, granularity: "week", source: "ai", periodStart: start, periodEnd: end,
    tasks: [{ title: "Read one article", estimatedMinutes: 20, scheduledFor: start }, { title: "An undated action", estimatedMinutes: 5 }] } as const;
  const orphan = await planService.createProposed(owner, { ...input, tasks: [...input.tasks] });
  assert.equal((await preview(orphan.id, orphan.version)).statusCode, 404);
  const live = await planService.createProposed(owner, { ...input, tasks: [...input.tasks],
    metadata: { planning_session_id: sessionId, subject_id: "read" } });
  const session = await repository.savePlanningSession({ ...owner, ...stamps, id: sessionId, goalId: goal.id,
    subjectId: "read", threadId: "preview-thread", status: "draft_ready", version: 1, contextRevision: 1, questions: [],
    clarificationRounds: 0, draftPlanId: live.id, draftRevision: 1, draftExpiresAt: end + "T23:59:00Z",
    baseSnapshot: await service.snapshot(owner, goal.id), context: { period_start: { value: start, source: "user" },
      period_end: { value: end, source: "user" }, available_minutes: { value: 50, source: "confirmed" } } });
  const result = await preview(live.id, live.version);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.envelope.data.undated_action_count, 1);
  assert.equal(result.envelope.data.block_reason, "missing_date");
  const [account, subject] = result.envelope.data.weeks;
  assert.deepEqual([account.scope, account.projected_minutes, account.limit_minutes, account.blocking], ["account", 20, 80, null]);
  assert.deepEqual([subject.scope, subject.subject_id, subject.projected_minutes, subject.limit_minutes, subject.shortfall_minutes, subject.blocking],
    ["subject", "read", 20, 15, 5, "over_limit"]);
  assert.equal((await repository.listTasks(owner)).length, 0);

  await repository.savePlanningSession({ ...session, draftExpiresAt: stamps.updatedAt }, session.version);
  const expired = await preview(live.id, live.version);
  assert.equal(expired.statusCode, 409);
  assert.equal(expired.envelope.code, "LIGHTTICK_PLANNING_STALE");
});
