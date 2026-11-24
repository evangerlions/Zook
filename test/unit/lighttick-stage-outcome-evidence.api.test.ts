import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickStageOutcomeEvidenceListEnvelopeSchema, LightTickStageOutcomeEvidenceWriteEnvelopeSchema,
  LightTickStageOutcomeEvidenceWriteRequestSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" };
const now = new Date("2026-11-29T16:30:00Z");
const today = "2026-11-30";
const firstMonth = { starts_on: "2026-10-01", ends_on: "2026-10-31" };
const secondMonth = { starts_on: "2026-11-01", ends_on: today };
const stages = ["reading", "writing", "result-only"].map(id => ({
  id, title: id, outcome_criteria: "Explain the result", starts_on: null, ends_on: null,
}));

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) {
    seed.appUsers.push({ id: "evidence-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN",
      joinedAt: now.toISOString() });
  }
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { key, userId = owner.userId as string | null, query = {} }: { key?: string; userId?: string | null; query?: HttpRequest["query"] } = {}) {
    const response = await app.handle({ path: "/api/v1/lighttick/" + path, method, query, body, headers: {
      ...(userId ? { authorization: "Bearer " + tokenService.issueAccessToken(userId, appId) } : {}),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": key ?? "outcome-proof-" + (++sequence),
    } });
    return { ...response, ...response.body as { data: any; code: string } };
  }
  const profile = await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" });
  assert.equal(profile.statusCode, 200, JSON.stringify(profile.body));
  const goal = await call("goals", "POST", { title: "Reading and writing", constraints: {} });
  assert.equal(goal.statusCode, 201, JSON.stringify(goal.body));
  const goalId: string = goal.data.id;
  const goalRoute = "goals/" + goalId;
  const roadmap = await call(goalRoute + "/roadmap", "PATCH", { base_version: 0, stages });
  assert.equal(roadmap.statusCode, 200, JSON.stringify(roadmap.body));
  async function confirm(stageId: string, titles: string[]) {
    const proposed = await call("manual-plans", "POST", {
      goal_id: goalId, stage_id: stageId, title: stageId, completion_criteria: "Write a note", period_start: today, period_end: "2026-12-06",
      tasks: titles.map((title, index) => ({ id: "evidence-task-" + index, title, scheduled_for: today,
        estimated_minutes: 10, completion_criteria: "One applied example", guidance: "" })),
    });
    assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.body));
    const confirmed = await call("manual-plans/" + proposed.data.id + "/confirm", "POST",
      { base_version: proposed.data.version, goal_base_version: proposed.data.goal_version });
    assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
    return confirmed.data.tasks as { id: string; title: string; version: number }[];
  }
  const complete = (task: { id: string; version: number }) =>
    call("tasks/" + task.id + "/complete", "POST", { base_version: task.version });
  const read = (query: HttpRequest["query"] = {}, userId?: string | null) =>
    call(goalRoute + "/outcome-evidence", "GET", undefined, { query, userId });
  const write = (input: Record<string, unknown>, key?: string, userId?: string) =>
    call(goalRoute + "/outcome-evidence", "POST", input, { key, userId });
  return { call, confirm, complete, read, write, repository, goalId, goalRoute, profile: profile.data };
}

test("stage evidence keeps local dates, only accepts scoped completed actions, and preserves the original facts", async () => {
  const { call, confirm, complete, read, write, repository, goalId, goalRoute, profile } = await fixture();
  const [completed, pending] = await confirm("reading", ["Read the article", "Read another"]);
  const [other] = await confirm("writing", ["Write a paragraph"]);
  assert.equal((await complete(completed!)).statusCode, 200);
  assert.equal((await complete(other!)).statusCode, 200);
  const before = await repository.getTask(owner, completed!.id);
  const data = await read({ stage_id: "reading", include_task_choices: "true", ...secondMonth });
  assert.equal(data.statusCode, 200);
  assert.equal(data.headers?.["Cache-Control"], "no-store");
  assert.deepEqual(data.data.task_choices, [{ task_id: completed!.id, title: completed!.title, completed_on: today }]);
  assert.deepEqual((await read({ stage_id: "reading", include_task_choices: "true", ...firstMonth })).data.task_choices, []);
  assert.equal((await read({ stage_id: "reading" })).data.task_choices, undefined);
  assert.equal((await read({}, null)).statusCode, 401);
  assert.equal((await read({}, "user_bob")).statusCode, 404);
  assert.equal((await read({ stage_id: "absent" })).statusCode, 404);
  assert.equal((await read({ starts_on: "2026-12-01", ends_on: today })).statusCode, 400);
  const input = { stage_id: "reading", occurred_on: today, metric: "Practice score", kind: "number",
    value: { value: 38, unit: "points", comparable_condition: "Same exercise" } };
  for (const task_id of [pending!.id, other!.id, "unknown-task"]) {
    const invalid = await write({ ...input, task_id });
    assert.equal(invalid.statusCode, 422, JSON.stringify(invalid.body));
    assert.equal(invalid.code, "LIGHTTICK_OUTCOME_SOURCE_INVALID");
  }
  assert.equal((await write({ ...input, occurred_on: "2026-12-01" })).statusCode, 400);
  assert.equal((await write({ ...input, value: { value: 0 } })).statusCode, 400);
  assert.equal((await write(input, undefined, "user_bob")).statusCode, 404);

  const body = { ...input, task_id: completed!.id };
  const saved = await write(body, "replay-original-measurement");
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const evidence = saved.data.evidence;
  assert.equal(evidence.occurred_on, today);
  assert.equal(evidence.recorded_at, now.toISOString());
  assert.equal(evidence.task_title, completed!.title);
  assert.equal(evidence.is_current, true);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  for (const [schema, value] of [[LightTickStageOutcomeEvidenceWriteRequestSchema, body],
    [LightTickStageOutcomeEvidenceWriteEnvelopeSchema, saved.body], [LightTickStageOutcomeEvidenceListEnvelopeSchema, data.body]] as const) {
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  assert.equal((await write({ ...body, metric: "Different result" }, "replay-original-measurement")).code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  const movedZone = await call("profile", "PATCH", { base_version: profile.version, timezone: "UTC" });
  assert.equal(movedZone.statusCode, 200, JSON.stringify(movedZone.body));
  const historical = await read({ stage_id: "reading", starts_on: today, ends_on: today });
  assert.equal(historical.data.timezone, "UTC");
  assert.equal(historical.data.items[0].occurred_on, today);
  assert.deepEqual(await repository.getTask(owner, completed!.id), before);
  const roadmap = await call(goalRoute + "/roadmap");
  assert.equal(roadmap.data.goal_id, goalId);
  assert.equal(roadmap.data.stages.find((stage: { id: string }) => stage.id === "reading").outcome, null);
});

test("corrections append one branch and apply across month filters, keeping result-only stages durable", async () => {
  const { call, confirm, complete, read, write, goalRoute } = await fixture();
  const [selected] = await confirm("reading", ["A completed activity"]);
  assert.equal((await complete(selected!)).statusCode, 200);
  const original = { stage_id: "reading", occurred_on: "2026-10-14", metric: "Reading recall", kind: "text",
    value: { value: "First note" }, task_id: selected!.id };
  const recorded = await write(original, "initial-history-replay");
  const first = recorded.data?.evidence;
  assert.equal(recorded.statusCode, 200, JSON.stringify(recorded.body));
  const correction = { stage_id: original.stage_id, occurred_on: today, metric: original.metric, kind: original.kind,
    value: { value: "Clarified note" }, corrects: { id: first.id, version: first.version } };
  const fork = await Promise.all([write(correction), write(correction)]);
  assert.deepEqual(fork.map(result => result.statusCode).sort(), [200, 409]);
  assert.equal(fork.find(result => result.statusCode === 409)?.code, "LIGHTTICK_VERSION_CONFLICT");
  const revised = fork.find(result => result.statusCode === 200)?.data.evidence;
  assert.equal(revised.version, 2);
  assert.equal(revised.corrected_from, first.id);
  assert.equal(revised.task_id, selected!.id);
  assert.equal(revised.task_title, selected!.title);
  const oldMonth = await read(firstMonth);
  assert.deepEqual(oldMonth.data.items, [{ ...first, is_current: false }]);
  const currentMonth = await read(secondMonth);
  assert.deepEqual(currentMonth.data.items, [revised]);
  assert.deepEqual((await write(original, "initial-history-replay")).data.evidence, first);

  const cleared = await write({ ...correction, task_id: null, corrects: { id: revised.id, version: revised.version } });
  assert.equal(cleared.statusCode, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.data.evidence.task_id, undefined);
  assert.equal(cleared.data.evidence.version, 3);
  const unrelated = await write({ ...correction, stage_id: "writing", corrects: { id: revised.id, version: revised.version } });
  assert.equal(unrelated.code, "LIGHTTICK_VERSION_CONFLICT");
  const status = { stage_id: "result-only", occurred_on: today, metric: "Demonstration outcome", kind: "status",
    value: { value: "unknown" } };
  assert.equal((await write(status)).statusCode, 200);
  const roadmap = await call(goalRoute + "/roadmap");
  const remove = await call(goalRoute + "/roadmap", "PATCH", { base_version: roadmap.data.version, stages: stages.slice(0, 2) });
  assert.equal(remove.code, "LIGHTTICK_VERSION_CONFLICT");
  const achieved = await call(goalRoute + "/roadmap/stages/result-only/outcome", "POST", {
    base_version: roadmap.data.version, state: "achieved", note: "Confirmed by the owner",
  });
  assert.equal(achieved.statusCode, 200, JSON.stringify(achieved.body));
  assert.equal((await write({ ...status, value: { value: "submitted" } })).statusCode, 200);
  const currentRoadmap = await call(goalRoute + "/roadmap");
  assert.equal(currentRoadmap.data.stages.find((stage: { id: string }) => stage.id === "result-only").outcome.state, "achieved");

  const current = await call(goalRoute);
  const paused = await call(goalRoute + "/lifecycle", "POST", { base_version: current.data.version, action: "pause", reason: "Time away" });
  assert.equal(paused.statusCode, 200, JSON.stringify(paused.body));
  assert.equal((await write(status)).code, "LIGHTTICK_STATE_TRANSITION_INVALID");
  assert.deepEqual((await read({ stage_id: "result-only" })).data.items.map((row: { value: { value: string } }) => row.value.value).sort(),
    ["submitted", "unknown"]);
});
