import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningAgendaEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
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
  return { request, write, agenda, draft, repository };
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
