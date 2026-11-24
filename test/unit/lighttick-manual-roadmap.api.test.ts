import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

test("manual stage linkage is explicit, stays attached for old edits, and rechecks stage state on confirmation", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({
    id: "roadmap-" + userId, appId: "lighttick", userId, status: "ACTIVE", accountRegion: "UNKNOWN",
    joinedAt: "2026-11-01T00:00:00Z",
  });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { tokenService, lighttickRuntime } = application.services;
  let sequence = 0;
  async function request(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    options: { user?: string; key?: string } = {}) {
    const result = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method, query: {}, body,
      headers: { "x-app-id": "lighttick", "x-lighttick-task-schema": "2",
        "idempotency-key": options.key ?? "roadmap-manual-" + ++sequence,
        authorization: "Bearer " + tokenService.issueAccessToken(options.user ?? "user_alice", "lighttick") },
    });
    return { status: result.statusCode, ...(result.body as { data: any; code: string }) };
  }
  async function write(path: string, body: HttpRequest["body"], method: HttpRequest["method"] = "POST", status = 200) {
    const result = await request(path, method, body);
    assert.equal(result.status, status, JSON.stringify(result));
    return result.data;
  }

  const goal = await write("goals", { title: "先讲结论", target_date: "2026-11-30" }, "POST", 201);
  const sibling = await write("goals", { title: "练习提问" }, "POST", 201);
  const roadmapRoute = "goals/" + goal.id + "/roadmap";
  const stage = { id: "conclusion-first", title: "先讲清结论", outcome_criteria: "听众能复述一个结论",
    starts_on: "2026-11-23", ends_on: "2026-11-29" };
  const undated = { ...stage, id: "before-report", title: "汇报前排练", starts_on: null, ends_on: null };
  const roadmap = await write(roadmapRoute, { base_version: 0, stages: [stage, undated] }, "PATCH");
  const plan = (action: string, date = "2026-11-23") => ({
    goal_id: goal.id, title: "一次汇报练习", completion_criteria: "写一句结论", period_start: date, period_end: date,
    tasks: [{ id: "reflection-action", title: action, scheduled_for: date, estimated_minutes: 15,
      completion_criteria: "留下一段可回看汇报", guidance: "" }],
  });

  assert.equal((await request("manual-plans", "POST", { ...plan("超出日期", "2026-11-30"), stage_id: stage.id })).code,
    "LIGHTTICK_ROADMAP_STAGE_WINDOW");
  assert.equal((await request("manual-plans", "POST", { ...plan("超过目标截止日", "2026-12-01"), stage_id: undated.id })).code,
    "LIGHTTICK_ROADMAP_STAGE_WINDOW");
  assert.equal((await request("manual-plans", "POST", { ...plan("另一个目标"), goal_id: sibling.id, stage_id: stage.id })).code,
    "LIGHTTICK_ROADMAP_STAGE_UNAVAILABLE");
  assert.equal((await request(roadmapRoute, "GET", undefined, { user: "user_bob" })).status, 404);
  const saved = await write("manual-plans", { ...plan("用一句话讲结论"), stage_id: stage.id });
  const route = "manual-plans/" + saved.id;
  assert.equal(saved.draft.stage_id, stage.id);
  const edited = await write(route, { ...plan("重写一句结论"), base_version: saved.version }, "PATCH");
  assert.equal(edited.draft.stage_id, stage.id);
  const owner = { appId: "lighttick", userId: "user_alice" };
  assert.equal((await lighttickRuntime.repository.getPlan(owner, saved.id))?.proposal.stage_id, stage.id);
  assert.deepEqual(await lighttickRuntime.repository.listTasks(owner), []);

  const body = { base_version: edited.version, goal_base_version: edited.goal_version };
  const first = await request(route + "/confirm", "POST", body, { key: "roadmap-confirm-same-key" });
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.data.tasks.length, 1);
  const evidence = await write(roadmapRoute + "/stages/" + stage.id + "/outcome", {
    base_version: roadmap.version, state: "achieved", note: "听众能复述结论。",
  });
  assert.equal(evidence.stages[0].outcome.state, "achieved");
  const replay = await request(route + "/confirm", "POST", body, { key: "roadmap-confirm-same-key" });
  assert.deepEqual(replay.data.tasks, first.data.tasks);
  assert.equal((await lighttickRuntime.repository.listTasks(owner)).length, 1);
  assert.equal((await request("manual-plans", "POST", { ...plan("已经结束"), stage_id: stage.id })).code,
    "LIGHTTICK_ROADMAP_STAGE_UNAVAILABLE");
});

test("changing a stage retains a stale manual draft for explicit review and can be cleared", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "manual-stage-review", appId: "lighttick", userId: "user_alice", status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: "2026-11-01T00:00:00Z" });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { tokenService } = application.services;
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"], body?: HttpRequest["body"]) {
    const result = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method, query: {}, body,
      headers: { "x-app-id": "lighttick", "x-lighttick-task-schema": "2", "idempotency-key": "review-stage-" + ++sequence,
        authorization: "Bearer " + tokenService.issueAccessToken("user_alice", "lighttick") },
    });
    return { status: result.statusCode, ...(result.body as { data: any; code: string }) };
  }
  const goal = (await call("goals", "POST", { title: "练表达" })).data;
  const route = "goals/" + goal.id + "/roadmap";
  const stage = { id: "first", title: "开头", outcome_criteria: "一次主旨清楚", starts_on: "2026-11-23", ends_on: "2026-11-29" };
  const savedRoadmap = await call(route, "PATCH", { base_version: 0, stages: [stage] });
  assert.equal(savedRoadmap.status, 200);
  const body = {
    goal_id: goal.id, stage_id: stage.id, title: "录一次开场", completion_criteria: "",
    period_start: stage.starts_on, period_end: stage.ends_on,
    tasks: [{ id: "stage-a", title: "录开头", scheduled_for: stage.ends_on, estimated_minutes: 10, completion_criteria: "", guidance: "" }],
  };
  const pending = await call("manual-plans", "POST", body);
  assert.equal(pending.status, 200);
  const draftRoute = "manual-plans/" + pending.data.id;
  const changed = await call(route, "PATCH", { base_version: savedRoadmap.data.version, stages: [{ ...stage, ends_on: "2026-11-28" }] });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  const confirm = (draft: { version: number; goal_version: number }) => call(draftRoute + "/confirm", "POST",
    { base_version: draft.version, goal_base_version: draft.goal_version });
  assert.equal((await confirm(pending.data)).code, "LIGHTTICK_VERSION_CONFLICT");
  const now = await call(draftRoute, "GET");
  assert.equal(now.data.draft.stage_id, stage.id);
  assert.equal((await confirm(now.data)).code, "LIGHTTICK_ROADMAP_STAGE_WINDOW");
  const detached = await call(draftRoute, "PATCH", { ...body, stage_id: null, base_version: now.data.version });
  assert.equal(detached.status, 200);
  assert.equal(detached.data.draft.stage_id, undefined);
  assert.equal((await confirm(detached.data)).status, 200);
});
