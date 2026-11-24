import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningAgendaEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-29T12:00:00Z");

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const id of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "agenda-" + id, appId, userId: id, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-11-01T00:00:00Z",
  });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const repository = lighttickRuntime.repository;
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  lighttickRuntime.tasks = new LightTickTaskService(repository, () => now);
  lighttickRuntime.plans = new LightTickPlanService(repository, () => now);
  let sequence = 0;
  async function request(path: string, options: {
    method?: HttpRequest["method"]; body?: HttpRequest["body"]; query?: HttpRequest["query"]; user?: string; unauthenticated?: boolean;
  } = {}) {
    const response = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method: options.method ?? "GET", query: options.query ?? {}, body: options.body,
      headers: {
        ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.user ?? owner.userId, appId) }),
        "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": "planning-agenda-test-" + (++sequence),
      },
    });
    return { ...response, envelope: response.body as { data: any; code: string } };
  }
  const agenda = (starts_on: string, ends_on: string, user?: string) => request("planning-agenda", { query: { starts_on, ends_on }, user });
  async function write(path: string, body: HttpRequest["body"], method: HttpRequest["method"] = "POST") {
    const response = await request(path, { method, body });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return response.envelope.data;
  }
  const draft = (title: string) => write("manual-plans", {
    title, completion_criteria: "One visible result", period_start: "2026-11-29", period_end: "2026-12-02",
    tasks: [
      { id: "agenda-move", title: "Move to December", scheduled_for: "2026-11-30", estimated_minutes: 40, completion_criteria: "Done", guidance: "" },
      { id: "agenda-done", title: "Keep completed", scheduled_for: "2026-11-29", estimated_minutes: 20, completion_criteria: "Done", guidance: "" },
      { id: "agenda-cancel", title: "Remove cancelled", scheduled_for: "2026-11-29", estimated_minutes: 15, completion_criteria: "Done", guidance: "" },
      { id: "agenda-undated", title: "Keep outside agenda", scheduled_for: null, estimated_minutes: null, completion_criteria: "Done", guidance: "" },
    ],
  });
  return { request, write, agenda, draft, repository, plans: lighttickRuntime.plans };
}

test("planning agenda is read-only, owner-scoped and respects confirmed status and changed task dates", async () => {
  const { request, write, agenda, draft, repository } = await fixture();
  await write("profile", { base_version: 0, timezone: "America/Los_Angeles" }, "PATCH");
  const oldPlan = await draft("Reviewed work");
  assert.deepEqual((await agenda("2026-11-29", "2026-12-03")).envelope.data.items, []);
  const confirmed = await write("manual-plans/" + oldPlan.id + "/confirm", { base_version: oldPlan.version, goal_base_version: oldPlan.goal_version });
  const moved = confirmed.tasks.find(task => task.title === "Move to December");
  const done = confirmed.tasks.find(task => task.title === "Keep completed");
  const cancelled = confirmed.tasks.find(task => task.title === "Remove cancelled");
  await write("tasks/" + moved.id + "/reschedule", { base_version: moved.version, target_date: "2026-12-02" });
  await write("tasks/" + cancelled.id + "/cancel", { base_version: cancelled.version });
  await write("tasks/" + done.id + "/complete", { base_version: done.version, actual_duration_minutes: 15, note: "Keep this private." });
  const facts = await repository.pullChanges(owner, 0, 100);
  const review = await agenda("2026-11-29", "2026-12-02");
  assert.equal(review.statusCode, 200);
  assert.equal(review.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningAgendaEnvelopeSchema);
  assert.equal(validate(review.body), true, JSON.stringify(validate.errors));
  assert.deepEqual(review.envelope.data, {
    starts_on: "2026-11-29", ends_on: "2026-12-02", timezone: "America/Los_Angeles",
    items: [
      { id: done.id, goal_id: oldPlan.goal_id, goal_title: "Reviewed work", title: done.title, status: "completed",
        scheduled_date: "2026-11-29", estimated_duration_minutes: 20, actual_duration_minutes: 15 },
      { id: moved.id, goal_id: oldPlan.goal_id, goal_title: "Reviewed work", title: moved.title, status: "pending",
        scheduled_date: "2026-12-02", estimated_duration_minutes: 40, actual_duration_minutes: null },
    ],
  });
  assert.deepEqual((await agenda("2026-12-01", "2026-12-31")).envelope.data.items.map(task => task.id), [moved.id]);
  assert.deepEqual((await agenda("2026-11-29", "2026-12-02", "user_bob")).envelope.data.items, []);
  assert.equal((await request("planning-agenda", { unauthenticated: true })).statusCode, 401);
  assert.deepEqual(await repository.pullChanges(owner, 0, 100), facts);
});

test("planning agenda rejects missing, invalid, reversed or oversized calendar windows", async () => {
  const { request, agenda } = await fixture();
  const missing = await request("planning-agenda", { query: { starts_on: "2026-12-01" } });
  const invalid = await agenda("2026-11-31", "2026-12-01");
  const reversed = await agenda("2026-12-02", "2026-12-01");
  const oversized = await agenda("2026-11-01", "2026-12-02");
  for (const result of [missing, invalid, reversed, oversized]) {
    assert.equal(result.statusCode, 400);
    assert.equal(result.envelope.code, "REQ_FIELD_INVALID");
  }
  assert.equal((await agenda("2026-12-01", "2026-12-31")).statusCode, 200);
  assert.equal((await agenda("2026-12-01", "2026-12-01")).statusCode, 200);
});

test("a goal-scoped history request retains authorized completed work by scheduled account date", async () => {
  const { request, write, agenda, repository, plans } = await fixture();
  await write("profile", { base_version: 0, timezone: "Asia/Shanghai" }, "PATCH");
  async function goal(title: string, user?: string) {
    const result = await request("goals", { method: "POST", body: { title }, user });
    assert.equal(result.statusCode, 201, JSON.stringify(result.body));
    return result.envelope.data.id as string;
  }
  const selected = await goal("Reviewed goal");
  const another = await goal("Another owned goal");
  const foreign = await goal("Other account's goal", "user_bob");
  const createPlan = async (goalId: string, inputs: [string, string][]) => {
    const draft = await plans.createProposed(owner, {
      goalId, source: "ai", granularity: "week", periodStart: "2026-11-29", periodEnd: "2026-12-06",
      tasks: inputs.map(([title, scheduledFor]) => ({ title, scheduledFor, estimatedMinutes: 15 })),
    });
    return plans.confirm(owner, draft.id, draft.version);
  };
  const old = await createPlan(selected, [
    ["On December 1 in Shanghai", "2026-11-30T16:01:00Z"],
    ["Still in November at completion", "2026-11-30T15:59:00Z"],
    ["Previously studied lesson", "2026-12-02"],
    ["Old pending action", "2026-12-01"],
  ]);
  const current = await createPlan(selected, [["Current action", "2026-12-02"]]);
  const other = await createPlan(another, [["Different goal action", "2026-12-02"]]);
  const writes = new ManualPlanningService(repository);
  const occurred = "2026-12-03T10:00:00Z";
  const [regular, outside, lesson] = old.tasks;
  assert.ok(regular && outside && lesson);
  const lessonSource = {
    route_id: "history-stopped-route", route_version: 1, lesson_number: 1, lesson_id: "history-lesson",
    content_version: "a".repeat(64), purpose: "learn",
  } as const;
  for (const task of [regular, outside, lesson]) {
    await repository.saveTask({ ...task, status: "completed", actualMinutes: 10, completedAt: occurred, updatedAt: occurred,
      ...(task.id === lesson.id ? { lessonSource } : {}) },
      writes.write(owner, "task", task.id, task.version + 1, "task_completed", occurred, { status: "completed" }), task.version);
  }
  await repository.savePlan({ ...old.plan, status: "superseded", updatedAt: occurred },
    writes.write(owner, "plan", old.plan.id, old.plan.version + 1, "learning_schedule_stopped", occurred, { status: "superseded" }),
    old.plan.version);
  const query = { starts_on: "2026-12-01", ends_on: "2026-12-31", goal_id: selected, include_completed_history: "true" };
  const scoped = () => request("planning-agenda", { query });
  const ids = (result: Awaited<ReturnType<typeof scoped>>) => result.envelope.data.items.map((task: { id: string }) => task.id).sort();

  assert.deepEqual(ids(await agenda(query.starts_on, query.ends_on)), [current.tasks[0]!.id, other.tasks[0]!.id].sort());
  assert.deepEqual(ids(await request("planning-agenda", { query: { ...query, include_completed_history: "false" } })),
    [current.tasks[0]!.id]);
  const withHistory = await scoped();
  assert.equal(withHistory.statusCode, 200, JSON.stringify(withHistory.body));
  assert.deepEqual(ids(withHistory), [regular.id, current.tasks[0]!.id].sort());
  assert.deepEqual(withHistory.envelope.data.items[0], {
    id: regular.id, goal_id: selected, goal_title: "Reviewed goal", title: regular.title, status: "completed",
    scheduled_date: "2026-12-01", estimated_duration_minutes: 15, actual_duration_minutes: 10,
  });
  const previousMonth = await request("planning-agenda", { query: { ...query, starts_on: "2026-11-01", ends_on: "2026-11-30" } });
  assert.deepEqual(ids(previousMonth), [outside.id]);

  const authority = {
    ...owner, phase: "zook", module: "learning", readingEnabled: true, privateEnabled: false, epoch: 1, revision: 1,
    manifestHash: null, sourceBinding: null, updatedAt: occurred,
  } as const;
  await repository.saveLearningAuthority(authority, 0);
  assert.deepEqual(ids(await scoped()), [regular.id, lesson.id, current.tasks[0]!.id].sort());
  await repository.saveLearningAuthority({ ...authority, readingEnabled: false, revision: 2 }, 1);
  assert.deepEqual(ids(await scoped()), [regular.id, current.tasks[0]!.id].sort());

  for (const inaccessible of [
    { query: { ...query, goal_id: foreign } },
    { query: { ...query, goal_id: "goal-does-not-exist" } },
    { query, user: "user_bob" },
  ]) {
    const result = await request("planning-agenda", inaccessible);
    assert.equal(result.statusCode, 404);
    assert.equal(result.envelope.code, "LIGHTTICK_RESOURCE_NOT_FOUND");
  }
  assert.equal((await request("planning-agenda", { query, unauthenticated: true })).statusCode, 401);
  assert.equal((await request("planning-agenda", { query: { ...query, goal_id: "" } })).statusCode, 400);
  assert.equal((await request("planning-agenda", { query: { ...query, include_completed_history: "1" } })).statusCode, 400);
});
