import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickStageArchiveEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { GOAL_ROADMAP_KEY } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-29T12:00:00Z");
const dated = {
  id: "dated", title: "Arrange one work report", outcome_criteria: "State one conclusion and two reasons",
  starts_on: "2026-11-20", ends_on: "2026-11-28",
};
const undated = {
  id: "undated", title: "Answer questions", outcome_criteria: "Record two concrete answers",
  starts_on: null, ends_on: null,
};

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateArchive = ajv.compile(LightTickStageArchiveEnvelopeSchema);

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "archive-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN",
    joinedAt: "2026-11-01T00:00:00Z",
  });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const repository = lighttickRuntime.repository;
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  lighttickRuntime.plans = new LightTickPlanService(repository, () => now);
  let sequence = 0;
  async function request(path: string, options: {
    method?: HttpRequest["method"]; body?: HttpRequest["body"]; who?: string; key?: string; unauthenticated?: boolean;
  } = {}) {
    const response = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method: options.method ?? "GET", query: {}, body: options.body,
      headers: {
        ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.who ?? owner.userId, appId) }),
        "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": options.key ?? "archive-" + (++sequence),
      },
    });
    return { ...response, envelope: response.body as { code: string; data: any } };
  }
  const goal = (await request("goals", { method: "POST", body: {
    title: "Improve reporting", target_date: "2026-12-20", constraints: {},
  } })).envelope.data;
  assert.equal((await request("goals/" + goal.id + "/roadmap", {
    method: "PATCH", body: { base_version: 0, stages: [dated, undated] },
  })).statusCode, 200);
  async function record(id: string, date: string, text: string) {
    const saved = await request("records/" + id, { method: "PUT", body: {
      raw_text: text, record_date: date, prompt_kind: "free", guided_answers: {}, tags: [], base_version: 0,
    } });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  }
  async function evidence(id: string, stageId: string, occurredOn: string, correctedFrom?: string) {
    await repository.stageOutcomeEvidence.add({
      ...owner, id, goalId: goal.id, stageId, occurredOn, recordedAt: now.toISOString(),
      metric: "Practice score", kind: "number",
      value: { value: 38, unit: "points", comparable_condition: "Same exercise" },
      version: 1, ...(correctedFrom ? { correctedFrom } : {}),
    });
  }
  return { request, repository, goal, record, evidence,
    archive: (stageId: string, options: Parameters<typeof request>[1] = {}) =>
      request("goals/" + goal.id + "/roadmap/stages/" + stageId + "/archive", options) };
}

test("stage archive aggregates read-only, windows account-scoped sources and reports gaps honestly", async () => {
  const { request, repository, goal, record, evidence, archive } = await fixture();
  await record("record-inside-01", "2026-11-22", "结论一：先说结果");
  await record("record-outside-01", "2026-11-29", "窗口外的记录不应进入归档");
  await evidence("evidence-current-01", dated.id, "2026-11-24");
  await evidence("evidence-corrected-01", dated.id, "2026-11-25", "evidence-current-01");

  const before = await repository.pullChanges(owner, 0, 200);
  const roadmapBefore = (await request("goals/" + goal.id + "/roadmap")).envelope.data;

  const response = await archive(dated.id);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.headers?.["Cache-Control"], "no-store");
  assert.equal(validateArchive(response.body), true, JSON.stringify(validateArchive.errors));
  const data = response.envelope.data;

  // Criteria are returned verbatim; no score, percentage or pass verdict is synthesized.
  assert.equal(data.outcome_criteria, dated.outcome_criteria);
  assert.equal(data.starts_on, dated.starts_on);
  assert.equal(data.ends_on, dated.ends_on);
  for (const forbidden of ["percentage", "progress", "score", "passed", "completion"]) {
    assert.equal(Object.hasOwn(data, forbidden), false, "archive must not synthesize " + forbidden);
  }

  // Account-scoped records are attributed by the stage date window only.
  assert.deepEqual(data.records.map((item: { source_id: string }) => item.source_id), ["record-inside-01"]);
  assert.equal(data.records[0].occurred_on, "2026-11-22");
  assert.equal(data.records[0].summary, "结论一：先说结果");

  // Only the current evidence row is listed; the correction is traceable, history is not rewritten.
  assert.deepEqual(data.outcomes.map((item: { source_id: string }) => item.source_id), ["evidence-corrected-01"]);
  assert.match(data.outcomes[0].reference, /corrects evidence-current-01/);
  assert.equal(data.outcomes[0].summary, "38 points Same exercise");

  // Empty sources are stated as empty, never fabricated.
  assert.deepEqual(data.missing_sources, ["lessons", "form_records"]);
  assert.deepEqual(data.evidence_coverage, [
    { source: "lessons", has_evidence: false, item_count: 0 },
    { source: "records", has_evidence: true, item_count: 1 },
    { source: "form_records", has_evidence: false, item_count: 0 },
    { source: "outcomes", has_evidence: true, item_count: 1 },
  ]);

  // Read-only: no change-log entry, no roadmap version bump, no new write path.
  assert.deepEqual(await repository.pullChanges(owner, 0, 200), before);
  assert.deepEqual((await request("goals/" + goal.id + "/roadmap")).envelope.data, roadmapBefore);

  // Owner scoping and unknown stage.
  assert.equal((await archive(dated.id, { who: "user_bob" })).statusCode, 404);
  assert.equal((await archive(dated.id, { unauthenticated: true })).statusCode, 401);
  assert.equal((await archive("absent-stage")).statusCode, 404);
  assert.equal((await archive(dated.id, { method: "POST" })).statusCode, 405);
});

test("a stage without dates keeps measured outcomes but cannot attribute windowed sources", async () => {
  const { repository, goal, record, evidence, archive } = await fixture();
  await record("record-undated-01", "2026-11-22", "无法归因到无日期阶段");
  await evidence("evidence-undated-01", undated.id, "2026-11-24");
  const data = (await archive(undated.id)).envelope.data;
  assert.equal(validateArchive((await archive(undated.id)).body), true);
  assert.equal(data.starts_on, null);
  assert.equal(data.ends_on, null);
  assert.deepEqual(data.records, []);
  assert.deepEqual(data.lessons, []);
  assert.deepEqual(data.form_records, []);
  assert.deepEqual(data.outcomes.map((item: { source_id: string }) => item.source_id), ["evidence-undated-01"]);
  assert.deepEqual(data.missing_sources, ["lessons", "records", "form_records"]);
  // The unwindowed record still exists; it was excluded, not deleted.
  assert.equal((await repository.listRecords(owner)).length, 1);
  assert.equal((await repository.getGoal(owner, goal.id))?.id, goal.id);
});

test("stage archive stays readable after the goal is archived and never reactivates it", async () => {
  const { request, repository, goal, evidence, archive } = await fixture();
  await evidence("evidence-paused-01", dated.id, "2026-11-24");
  const current = (await request("goals/" + goal.id)).envelope.data;
  const paused = await request("goals/" + goal.id + "/lifecycle", { method: "POST",
    body: { action: "archive", base_version: current.version } });
  assert.equal(paused.statusCode, 200, JSON.stringify(paused.body));
  assert.equal(paused.envelope.data.status, "archived");
  const response = await archive(dated.id);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.envelope.data.outcomes.length, 1);
  assert.equal((await repository.getGoal(owner, goal.id))?.status, "archived");
  const constraints = (await repository.getGoal(owner, goal.id))?.constraints as Record<string, any>;
  assert.equal(constraints[GOAL_ROADMAP_KEY].version, 1);
});