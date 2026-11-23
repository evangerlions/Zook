import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickErrorCodeSchema, LightTickNextWeekAdviceRequestSchema, LightTickNextWeekAdviceWindowSchema, LightTickNextWeekFactSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const now = new Date("2026-11-26T16:30:00Z");
const today = "2026-11-27";
const period = { period_start: "2026-11-23", period_end: "2026-11-29" };
const stages = ["first", "second"].map(id => ({ id, title: id, outcome_criteria: "Show an example", starts_on: null, ends_on: null }));
const numeric = {
  stage_id: "first", occurred_on: today, metric: "Clear sentences",
  kind: "number", value: { value: 12, unit: "sentences", comparable_condition: "UNSHARED_COMPARABLE_CONDITION" },
};
const textOutcome = {
  stage_id: "first", occurred_on: today, metric: "Feedback summary", kind: "text",
  value: { value: "HELD_BACK_FULL_TEXT  The pause helped.\nSay the finding first.  HELD_BACK_END" },
};
const excerpt = " The pause helped.\nSay the finding first. ";

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "weekly-evidence-" + userId, appId: owner.appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString(),
  });
  const delivery = seed.appConfigs.find(config => config.appId === owner.appId && config.configKey === "admin.delivery_config")!;
  const config = JSON.parse(delivery.configValue);
  delivery.configValue = JSON.stringify({ ...config, enabled: true, settings: { ...config.settings, runtimeScope: "full" },
    featureFlags: { ...config.featureFlags, aiPlanning: true } });
  const { app, queue, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.planningEnabled = true;
  runtime.today = new LightTickTodayService(repository, () => now);
  let seq = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { key, userId = owner.userId as string, query }: { key?: string; userId?: string; query?: HttpRequest["query"] } = {}) {
    const result = await app.handle({ path: "/api/v1/lighttick/" + path, method, body, query, headers: {
      authorization: "Bearer " + tokenService.issueAccessToken(userId, owner.appId),
      "x-app-id": owner.appId, "idempotency-key": key ?? "next-week-evidence-test-" + (++seq),
    } });
    const { code, data } = result.body as { code: string; data: any };
    return { status: result.statusCode, code, data };
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).status, 200);
  async function createGoal(title: string) {
    const created = await call("goals", "POST", { title, constraints: {} });
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.data.id as string;
    const path = "goals/" + id;
    const roadmap = await call(path + "/roadmap", "PATCH", { base_version: 0, stages });
    assert.equal(roadmap.status, 200, JSON.stringify(roadmap));
    const draft = await call("manual-plans", "POST", { goal_id: id, stage_id: "first", title: "First practice",
      completion_criteria: "Record an example", period_start: today, period_end: "2026-11-29",
      tasks: [{ id: "first-existing-action", title: "Existing practice", scheduled_for: today,
        estimated_minutes: 10, completion_criteria: "One clear sentence", guidance: "" }] });
    assert.equal(draft.status, 200, JSON.stringify(draft));
    const confirmed = await call("manual-plans/" + draft.data.id + "/confirm", "POST",
      { base_version: draft.data.version, goal_base_version: draft.data.goal_version });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    return { id, path, roadmap: roadmap.data };
  }
  const goal = await createGoal("Briefing practice");
  const path = goal.path + "/next-week-advice";
  async function outcome(body: HttpRequest["body"], goalPath = goal.path) {
    const result = await call(goalPath + "/outcome-evidence", "POST", body);
    assert.equal(result.status, 200, JSON.stringify(result));
    const { id, version } = result.data.evidence as { id: string; version: number };
    return { id, version };
  }
  const generate = (outcomeSource: Record<string, unknown>, options: { key?: string; userId?: string } = {},
    extra: Record<string, unknown> = {}) => call(path, "POST", { ...period, outcome_source: outcomeSource, ...extra }, options);
  const latest = () => call(path, "GET", undefined, { query: period });
  const decide = (runId: string, body: HttpRequest["body"], key?: string) =>
    call(path + "/" + runId + "/decision", "POST", body, { key });
  async function addTask(goalId: string, title: string, scheduledFor: string, estimatedMinutes: number | null) {
    const draft = await call("manual-plans", "POST", { goal_id: goalId, title, completion_criteria: "",
      period_start: today, period_end: "2026-12-06", tasks: [{ id: "next-week-fixture", title, scheduled_for: scheduledFor,
        estimated_minutes: estimatedMinutes, completion_criteria: "One result", guidance: "" }] });
    assert.equal(draft.status, 200, JSON.stringify(draft));
    const approved = await call("manual-plans/" + draft.data.id + "/confirm", "POST",
      { base_version: draft.data.version, goal_base_version: draft.data.goal_version });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    return (await repository.getTask(owner, approved.data.tasks[0].id))!;
  }
  async function execute(inspect: (request: LLMCompletionRequest) => unknown) {
    const runner = new LightTickAiRunner(repository, { complete: async request => ({
      provider: "stub", providerModel: "stub", modelKey: "stub", text: JSON.stringify(await inspect(request)),
    }) }, () => now, undefined, undefined, async () => true);
    runtime.worker = new LightTickWorker(runner);
    await queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  }
  return { addTask, call, createGoal, decide, execute, generate, goal, latest, outcome, repository };
}

function suggested(evidenceId: string, scheduled_for = "2026-12-01", estimated_minutes = 15) {
  return { decision: "adjust", summary: "Use a small example from the next stage.", tasks: [{
    title: "Describe one sample finding", scheduled_for, estimated_minutes,
    completion_criteria: "Explain one finding in one clear sentence", reason: "Follow up on the selected evidence.",
    evidence_ids: ["stage_outcome:" + evidenceId],
  }] };
}

function adopt(evidenceId: string, scheduled?: string, estimate?: number) {
  const { title, scheduled_for, estimated_minutes, completion_criteria } = suggested(evidenceId, scheduled, estimate).tasks[0]!;
  return { decision: "apply", tasks: [{ id: "step-1", title, scheduled_for, estimated_minutes, completion_criteria }] };
}

test("weekly advice accepts only one explicit same-goal current outcome through the business date", async () => {
  const { call, createGoal, execute, generate, goal, latest, outcome, repository } = await fixture();
  const selected = await outcome(textOutcome);
  const outcomeDecision = await call(goal.path + "/roadmap/stages/first/outcome", "POST",
    { base_version: goal.roadmap.version, state: "achieved", note: "ACHIEVEMENT_NOTE_NOT_SELECTED" });
  assert.equal(outcomeDecision.status, 200, JSON.stringify(outcomeDecision));
  const notSelected = await outcome({ ...numeric, stage_id: "second", metric: "OTHER_STAGE_EVIDENCE" });
  const older = await outcome({ ...numeric, occurred_on: "2026-11-22" });
  const foreign = await outcome(numeric, (await createGoal("OTHER_GOAL")).path);
  const storedFuture = { ...owner, goalId: goal.id, id: "future-evidence", stageId: "first", occurredOn: "2026-11-28",
    recordedAt: now.toISOString(), version: 1, metric: "Future evidence", kind: "status", value: { value: "accepted" } } as const;
  await repository.stageOutcomeEvidence.add(storedFuture);
  const reflection = await call("reflections/weekly-reflection", "PUT", { goal_id: goal.id, ...period, base_version: 0,
    content: "Selected reflection. PRIVATE_REVIEW", next_action: "PRIVATE_NEXT" });
  assert.equal(reflection.status, 200, JSON.stringify(reflection));
  for (const evidenceId of [older.id, foreign.id, storedFuture.id, "missing-stage-evidence"]) {
    assert.equal((await generate({ evidence_id: evidenceId })).status, 404);
  }
  assert.equal((await generate({ evidence_id: selected.id, excerpt }, { userId: "user_bob" })).status, 404);
  for (const source of [
    { evidence_id: selected.id }, { evidence_id: selected.id, excerpt: excerpt.trim().replace("\n", " ") },
    { evidence_id: selected.id, excerpt: "x".repeat(501) }, { evidence_id: notSelected.id, excerpt: "Optional?" },
  ]) assert.equal((await generate(source)).status, 400);
  const body = { ...period, outcome_source: { evidence_id: selected.id, excerpt }, source: {
    reflection_id: reflection.data.id, reflection_version: reflection.data.version, excerpt: "Selected reflection.",
  } };
  const queued = await generate(body.outcome_source, {}, { source: body.source });
  assert.equal(queued.status, 202, JSON.stringify(queued));
  const captured = queued.data.latest.facts.find((fact: { kind: string }) => fact.kind === "stage_outcome");
  assert.deepEqual(captured, { id: "stage_outcome:" + selected.id, kind: "stage_outcome", title: "Feedback summary",
    occurred_on: today, stage_id: "first", evidence_id: selected.id, outcome: { kind: "text", excerpt } });
  assert.equal((await generate({ evidence_id: notSelected.id })).code, "LIGHTTICK_NEXT_WEEK_NOT_READY");
  assert.equal((await generate(body.outcome_source, {}, { source: body.source })).data.latest.id, queued.data.latest.id);
  const schema = addFormats(new Ajv2020({ strict: false, validateSchema: false }));
  assert.equal(schema.validate(LightTickNextWeekAdviceRequestSchema, body), true, JSON.stringify(schema.errors));
  assert.equal(schema.validate(LightTickNextWeekFactSchema, captured), true, JSON.stringify(schema.errors));
  assert.equal(schema.validate(LightTickNextWeekFactSchema, { id: captured.id, kind: captured.kind, title: captured.title }), false);
  for (const code of ["LIGHTTICK_NEXT_WEEK_NOT_READY", "LIGHTTICK_NEXT_WEEK_ALREADY_DECIDED", "LIGHTTICK_NEXT_WEEK_STALE"])
    assert.equal(schema.validate(LightTickErrorCodeSchema, code), true, JSON.stringify(schema.errors));

  const tasks = await repository.listTasks(owner);
  await execute(request => {
    const raw = request.messages.at(-1)!.content!;
    const input = JSON.parse(raw.slice(raw.indexOf("INPUT_JSON=") + "INPUT_JSON=".length));
    assert.deepEqual(input.facts.filter((fact: { kind: string }) => fact.kind === "stage_outcome"), [
      { id: captured.id, kind: captured.kind, title: captured.title, occurred_on: today, outcome: captured.outcome },
    ]);
    assert.equal(input.selected_reflection_excerpt, "Selected reflection.");
    assert.doesNotMatch(raw, /HELD_BACK|PRIVATE_|OTHER_STAGE|OTHER_GOAL|UNSHARED_COMPARABLE_CONDITION|ACHIEVEMENT_NOTE_NOT_SELECTED|evidence_id"|stage_id"/u);
    assert.equal(request.providerOptions?.zookLogBodyMode, "suppress");
    return suggested(selected.id);
  });
  const ready = await latest();
  assert.equal(ready.data.latest.status, "succeeded", JSON.stringify(ready));
  assert.deepEqual(await repository.listTasks(owner), tasks);
});

test("a correction invalidates pending or undecided advice, while an accepted schedule receipt remains exact", async () => {
  const { decide, execute, generate, latest, outcome, repository } = await fixture();
  const selected = await outcome(numeric);
  const requestKey = "weekly-evidence-generate";
  const queued = await generate({ evidence_id: selected.id }, { key: requestKey });
  assert.equal(queued.status, 202, JSON.stringify(queued));
  const { id: runId } = queued.data.latest;
  const correction = await outcome({ ...numeric, value: { ...numeric.value, value: 13 }, corrects: selected });
  const stale = await latest();
  assert.equal(stale.data.latest.id, runId);
  assert.equal(stale.data.latest.stale, true);
  assert.equal((await generate({ evidence_id: selected.id }, { key: requestKey })).data.latest.id, runId);
  let calls = 0;
  await execute(() => { calls++; return suggested(selected.id); });
  assert.equal(calls, 0);
  const failure = await latest();
  assert.equal(failure.data.latest.status, "failed");
  assert.equal(failure.data.latest.error_code, "LIGHTTICK_VERSION_CONFLICT");

  const fresh = await generate({ evidence_id: correction.id });
  assert.equal(fresh.status, 202, JSON.stringify(fresh));
  await execute(request => {
    assert.ok(request.messages.at(-1)!.content!.includes('"outcome":{"kind":"number","value":13,"unit":"sentences"}'));
    assert.doesNotMatch(request.messages.at(-1)!.content!, /UNSHARED_COMPARABLE_CONDITION/u);
    return suggested(correction.id);
  });
  const status = await outcome({ ...numeric, kind: "status", value: { value: "accepted" }, corrects: correction });
  const staleProposal = await latest();
  assert.equal(staleProposal.data.latest.status, "succeeded");
  assert.equal(staleProposal.data.latest.stale, true);
  assert.equal(staleProposal.data.latest.output.tasks.length, 1);
  assert.equal((await decide(fresh.data.latest.id, { decision: "keep" })).code, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal((await decide(fresh.data.latest.id, adopt(correction.id))).code, "LIGHTTICK_VERSION_CONFLICT");

  const queuedStatus = await generate({ evidence_id: status.id });
  assert.equal(queuedStatus.status, 202, JSON.stringify(queuedStatus));
  await execute(request => {
    assert.ok(request.messages.at(-1)!.content!.includes('"outcome":{"kind":"status","value":"accepted"}'));
    return suggested(status.id);
  });
  const before = await repository.listTasks(owner);
  const appliedKey = "weekly-evidence-adopt";
  const accepted = await decide(queuedStatus.data.latest.id, adopt(status.id), appliedKey);
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  assert.equal(accepted.data.decision, "applied");
  const after = await repository.listTasks(owner);
  assert.equal(after.length, before.length + 1);
  assert.ok(after.some(task => task.planId === accepted.data.plan_id && task.scheduledFor?.startsWith("2026-12-01")));
  await outcome({ ...numeric, kind: "status", value: { value: "failed" }, corrects: status });
  assert.deepEqual(await decide(queuedStatus.data.latest.id, adopt(status.id), appliedKey), accepted);
  assert.equal((await latest()).data.latest.stale, undefined);
  assert.deepEqual(await repository.listTasks(owner), after);
});

test("correction during the worker call prevents the proposal from being published", async () => {
  const { execute, generate, latest, outcome } = await fixture();
  const selected = await outcome(numeric);
  assert.equal((await generate({ evidence_id: selected.id })).status, 202);
  let calls = 0;
  await execute(async () => {
    calls++;
    await outcome({ ...numeric, value: { ...numeric.value, value: 14 }, corrects: selected });
    return suggested(selected.id);
  });
  const failure = await latest();
  assert.equal(calls, 1);
  assert.equal(failure.data.latest.status, "failed");
  assert.equal(failure.data.latest.error_code, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal(failure.data.latest.output, undefined);
});

const monday = "2026-11-30", tuesday = "2026-12-01", wednesday = "2026-12-02";

function promptInput(request: LLMCompletionRequest) {
  const raw = request.messages.at(-1)!.content!;
  return JSON.parse(raw.slice(raw.indexOf("INPUT_JSON=") + "INPUT_JSON=".length));
}

test("weekly advice sees shared time and calendar dates, validates proposals and uses a midweek deadline on confirmation", async () => {
  const { addTask, call, createGoal, decide, execute, generate, goal, latest, outcome, repository } = await fixture();
  const other = await createGoal("OTHER_GOAL_CAPACITY_PRIVATE");
  const reserved = await addTask(other.id, "OTHER_ACTION_CAPACITY_PRIVATE", monday, 75);
  const currentGoal = (await repository.getGoal(owner, goal.id))!;
  const dated = await call(goal.path, "PATCH", { base_version: currentGoal.version, target_date: wednesday });
  assert.equal(dated.status, 200, JSON.stringify(dated));
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 100, plan_percent: 100 })).status, 200);
  assert.equal((await call("planning-calendar/availability", "PUT", { base_version: 0, available_weekdays: [1, 2, 5] })).status, 200);
  assert.equal((await call("planning-calendar/rest", "PUT", { base_version: 0, date: tuesday, planned_rest: true })).status, 200);
  const initialWindow = (await latest()).data;
  const validateWindow = addFormats(new Ajv2020({ strict: false, validateSchema: false })).compile(LightTickNextWeekAdviceWindowSchema);
  assert.equal(validateWindow(initialWindow), true, JSON.stringify(validateWindow.errors));
  const early = initialWindow.availability;
  assert.deepEqual(early.account, { limit_minutes: 100, known_minutes: 75, unknown_count: 0, remaining_minutes: 25 });
  assert.equal(early.goal.known_minutes, 0);
  assert.equal(early.can_schedule, true);
  assert.equal(early.timezone, "Asia/Shanghai");
  assert.equal(early.starts_on, monday);
  assert.equal(early.ends_on, "2026-12-06");
  assert.deepEqual(early.days.slice(0, 4).map((item: { blocking_reason: string | null }) => item.blocking_reason),
    [null, "planned_rest", "unavailable_day", "after_deadline"]);

  const evidence = await outcome(numeric);
  for (const [date, minutes, reason] of [
    [monday, 26, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED"],
    [tuesday, 25, "LIGHTTICK_PLANNED_REST_CONFLICT"],
    [wednesday, 25, "LIGHTTICK_UNAVAILABLE_PLANNING_DAY"],
  ] as const) {
    const queued = await generate({ evidence_id: evidence.id });
    assert.equal(queued.status, 202, JSON.stringify(queued));
    await execute(request => {
      const input = promptInput(request);
      assert.deepEqual(input.availability, early);
      assert.doesNotMatch(JSON.stringify(input), /OTHER_GOAL_CAPACITY_PRIVATE|OTHER_ACTION_CAPACITY_PRIVATE/u);
      assert.ok(!JSON.stringify(input).includes(other.id) && !JSON.stringify(input).includes(reserved.id));
      return suggested(evidence.id, date, minutes);
    });
    const failed = (await latest()).data.latest;
    assert.equal(failed.status, "failed", JSON.stringify(failed));
    assert.equal(failed.error_code, reason);
  }
  const queued = await generate({ evidence_id: evidence.id });
  await execute(() => suggested(evidence.id, monday, 25));
  const ready = (await latest()).data.latest;
  assert.equal(ready.status, "succeeded", JSON.stringify(ready));
  assert.deepEqual(ready.availability, early);
  const before = (await repository.listTasks(owner)).length;
  assert.equal((await decide(queued.data.latest.id, adopt(evidence.id, tuesday, 25))).code, "LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await decide(queued.data.latest.id, adopt(evidence.id, monday, 26))).code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  assert.equal((await repository.listTasks(owner)).length, before);
  const key = "review-capacity-accepted";
  const accepted = await decide(queued.data.latest.id, adopt(evidence.id, monday, 25), key);
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  assert.equal((await repository.getPlan(owner, accepted.data.plan_id))?.periodEnd, wednesday);
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 1, weekly_available_minutes: 80, plan_percent: 100 })).status, 200);
  assert.deepEqual(await decide(queued.data.latest.id, adopt(evidence.id, monday, 25), key), accepted);
  assert.deepEqual(await repository.getTask(owner, reserved.id), reserved);
});

test("unknown workload makes advice keep-only until an estimate is recorded, and availability changes stale new advice", async () => {
  const { addTask, call, createGoal, decide, execute, generate, latest, outcome, repository } = await fixture();
  const other = await createGoal("Another scheduled goal");
  await addTask(other.id, "Known work", monday, 45);
  const unknown = await addTask(other.id, "Needs an estimate", tuesday, null);
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 100, plan_percent: 100 })).status, 200);
  const availability = (await latest()).data.availability;
  assert.deepEqual(availability.account, { limit_minutes: 100, known_minutes: 45, unknown_count: 1, remaining_minutes: null });
  assert.equal(availability.can_schedule, false);
  assert.equal(availability.blocking_reason, "missing_estimate");
  const evidence = await outcome(numeric);
  const first = await generate({ evidence_id: evidence.id });
  assert.equal(first.status, 202, JSON.stringify(first));
  await execute(request => {
    assert.equal(promptInput(request).account_pending_unknown_count, 1);
    return suggested(evidence.id, monday, 5);
  });
  assert.equal((await latest()).data.latest.error_code, "LIGHTTICK_AI_RUN_FAILED");
  const allowed = await generate({ evidence_id: evidence.id });
  await execute(() => ({ decision: "keep", summary: "Estimate the existing work first.", tasks: [] }));
  assert.equal((await latest()).data.latest.output.decision, "keep");
  await new LightTickTaskService(repository, () => now).progress(owner, unknown.id, unknown.version, { action: "set_remaining", estimate: 20 });
  assert.equal((await latest()).data.latest.stale, true);
  assert.equal((await decide(allowed.data.latest.id, { decision: "keep" })).code, "LIGHTTICK_VERSION_CONFLICT");
  const nextAdvice = await generate({ evidence_id: evidence.id });
  assert.equal(nextAdvice.data.availability.account.remaining_minutes, 35);
  await execute(() => suggested(evidence.id, monday, 20));
  assert.equal((await latest()).data.latest.status, "succeeded");
  assert.equal((await call("planning-calendar/rest", "PUT", { base_version: 0, date: monday, planned_rest: true })).status, 200);
  const changed = await latest();
  assert.equal(changed.data.latest.stale, true);
  assert.equal(changed.data.latest.availability.days[0].blocking_reason, null);
  assert.equal(changed.data.availability.days[0].blocking_reason, "planned_rest");
  assert.equal((await decide(nextAdvice.data.latest.id, adopt(evidence.id, monday, 20))).code, "LIGHTTICK_VERSION_CONFLICT");
});

test("an ordinary carried action reuses its one reservation across dates even at the shared limit", async () => {
  const { addTask, call, createGoal, decide, execute, generate, goal, latest, outcome, repository } = await fixture();
  const other = await createGoal("Separate booked effort");
  await addTask(other.id, "Other reserved work", monday, 80);
  const original = await addTask(goal.id, "Short reporting exercise", today, 35);
  const tasks = new LightTickTaskService(repository, () => now);
  const partial = (await tasks.progress(owner, original.id, original.version, {
    action: "record_partial", outcome: "Saved opening", remainingWork: "Practice the takeaway", actualMinutes: 9, estimate: 20,
  })).task;
  const rescheduled = await tasks.command(owner, original.id, partial.version, { action: "reschedule", date: monday });
  assert.equal(rescheduled.scheduledFor, monday);
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 100, plan_percent: 100 })).status, 200);
  const availability = (await latest()).data.availability;
  assert.equal(availability.account.remaining_minutes, 0);
  assert.equal(availability.can_schedule, true);
  const evidence = await outcome(numeric);
  const queued = await generate({ evidence_id: evidence.id });
  await execute(request => {
    const input = promptInput(request);
    const carry = input.carry_sources.find((source: { id: string }) => source.id === original.id);
    assert.equal(carry.occupied_date, monday);
    assert.equal(carry.occupied_minutes, 20);
    const proposal = suggested(evidence.id, tuesday, 20);
    return { ...proposal, tasks: [{ ...proposal.tasks[0], source_task_id: original.id, evidence_ids: carry.evidence_ids }] };
  });
  const review = (await latest()).data.latest;
  assert.equal(review.status, "succeeded", JSON.stringify(review));
  assert.equal((await decide(queued.data.latest.id, adopt(evidence.id, tuesday, 21))).code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  const accepted = await decide(queued.data.latest.id, adopt(evidence.id, tuesday, 20));
  assert.equal(accepted.status, 200, JSON.stringify(accepted));
  const old = (await repository.getTask(owner, original.id))!;
  const newTask = (await repository.listTasks(owner, accepted.data.plan_id))[0]!;
  assert.equal(old.status, "cancelled");
  assert.equal(old.executionProgress?.outcome, "Saved opening");
  assert.equal(old.executionProgress?.transferredToTaskId, newTask.id);
  const after = await call("planning-capacity", "GET", undefined, { query: { date: monday } });
  assert.equal(after.data.week.known_minutes, 100);
});
