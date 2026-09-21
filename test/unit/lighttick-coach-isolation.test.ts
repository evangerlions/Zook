import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { assembleChatContext } from "../../src/modules/lighttick/ai/lighttick-ai-context.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
const owner = { appId: "lighttick" as const, userId: "user_alice" };
const other = { ...owner, userId: "user_bob" };
const clock = () => new Date("2026-09-21T08:00:00Z");
async function goalTask(repository: any, who = owner, title = "Course") {
  const goal = await new LightTickGoalService(repository, clock).create(who, { title, constraints: {} });
  const plans = new LightTickPlanService(repository, clock);
  const plan = await plans.createProposed(who, { goalId: goal.id, granularity: "week", periodStart: "2026-09-21",
    periodEnd: "2026-09-27", source: "ai", tasks: [{ title: title + " task", estimatedMinutes: 10, priority: 1, scheduledFor: "2026-09-21" }] });
  await plans.confirm(who, plan.id, plan.version);
  return { goal, plan, task: (await repository.listTasks(who, plan.id))[0] };
}
test("Coach counts real task events for only its goal and filters history before limiting", async () => {
  const repo = new InMemoryLightTickRepository();
  const a = await goalTask(repo), b = await goalTask(repo, owner, "Exercise"), c = await goalTask(repo, other, "Other account");
  const tasks = new LightTickTaskService(repo, clock);
  for (const [f, who] of [[a, owner], [b, owner], [c, other]] as const)
    await tasks.command(who, f.task.id, f.task.version, { action: "complete", actualMinutes: f === a ? 12 : 100 });
  await repo.saveChatMessage({ ...owner, id: "a", goalId: a.goal.id, threadId: "shared", role: "user", content: "course only", createdAt: "2026-09-21T08:00:00Z" });
  await repo.saveChatMessage({ ...owner, id: "b", goalId: b.goal.id, threadId: "shared", role: "assistant", content: "exercise secret", createdAt: "2026-09-21T08:01:00Z" });
  await repo.saveChatMessage({ ...other, id: "c", goalId: c.goal.id, threadId: "shared", role: "user", content: "account secret", createdAt: "2026-09-21T08:02:00Z" });
  const context = await assembleChatContext(repo, owner, { goal_id: a.goal.id }, "shared", 1);
  assert.equal(context.execution_facts.completed_count, 1);
  assert.equal(context.execution_facts.average_deviation_minutes, 2);
  assert.deepEqual(context.conversation, [{ role: "user", content: "course only" }]);
  assert.doesNotMatch(JSON.stringify(context), /exercise secret|account secret|Exercise task/);
});
test("Coach rejects foreign goal tasks and inconsistent task/plan references", async () => {
  const repo = new InMemoryLightTickRepository();
  const a = await goalTask(repo), b = await goalTask(repo, owner, "Exercise"), c = await goalTask(repo, other);
  await assert.rejects(assembleChatContext(repo, owner, { goal_id: a.goal.id, task_id: b.task.id }, "shared"), { code: "LIGHTTICK_PLAN_CONSTRAINT_FAILED" });
  await assert.rejects(assembleChatContext(repo, owner, { goal_id: a.goal.id, task_id: c.task.id }, "shared"), { code: "LIGHTTICK_RESOURCE_NOT_FOUND" });
  const plans = new LightTickPlanService(repo, clock);
  const p = await plans.createProposed(owner, { goalId: a.goal.id, granularity: "week", periodStart: "2026-09-28", periodEnd: "2026-10-04", source: "ai", tasks: [{ title: "Next", estimatedMinutes: 10, priority: 1 }] });
  await assert.rejects(assembleChatContext(repo, owner, { goal_id: a.goal.id, plan_id: p.id, task_id: a.task.id }, "shared"), { code: "LIGHTTICK_PLAN_CONSTRAINT_FAILED" });
  const valid = await assembleChatContext(repo, owner, { goal_id: a.goal.id, plan_id: a.plan.id, task_id: a.task.id }, "shared");
  assert.equal(valid.task?.id, a.task.id);
});
test("HTTP history is goal scoped and invalid chat references leave no messages or runs", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "isolation_member", appId: "lighttick", userId: owner.userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: clock().toISOString() });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime;
  const repo = runtime.repository;
  const a = await goalTask(repo), b = await goalTask(repo, owner, "Exercise");
  const headers = { authorization: `Bearer ${app.services.tokenService.issueAccessToken(owner.userId, "lighttick")}` };
  await repo.saveChatMessage({ ...owner, id: "a", goalId: a.goal.id, threadId: "same", role: "user", content: "A only", createdAt: "2026-09-21T08:00:00Z" });
  await repo.saveChatMessage({ ...owner, id: "b", goalId: b.goal.id, threadId: "same", role: "user", content: "B only", createdAt: "2026-09-21T08:01:00Z" });
  const history = await app.app.handle({ method: "GET", path: "/api/v1/lighttick/chat/messages", headers, query: { goal_id: a.goal.id, thread_id: "same", limit: "1" } });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(history.body.data.items.map((m: any) => m.content), ["A only"]);
  let runWrites = 0;
  const saveRun = repo.saveAiRun.bind(repo);
  repo.saveAiRun = async row => { runWrites++; return saveRun(row); };
  const result = await app.app.handle({ method: "POST", path: "/api/v1/lighttick/coach-runs", headers: { ...headers, "idempotency-key": "reject-wrong-task" }, body: { goal_id: a.goal.id, task_id: b.task.id, scene: "chat", thread_id: "same", message: "must not save" } });
  assert.equal(result.statusCode, 422);
  assert.equal(runWrites, 0);
  assert.equal((await repo.listChatMessages(owner, "same", 50)).length, 2);
});

test("Planning clarification does not inherit messages injected under another goal", async () => {
  const { LightTickPlanningService } = await import("../../src/modules/lighttick/planning/planning.service.ts");
  const repo = new InMemoryLightTickRepository();
  const a = await goalTask(repo), b = await goalTask(repo, owner, "Exercise");
  const service = new LightTickPlanningService(repo, clock);
  const { session } = await service.command(owner, "create-session", "create", undefined, { goal_id: a.goal.id });
  await repo.saveChatMessage({ ...owner, id: "injected", goalId: b.goal.id, threadId: session.threadId, role: "user", content: "other goal details", createdAt: clock().toISOString() });
  const result = await service.command(owner, "clarify", "messages", session.id, { base_version: session.version, message: "course details" });
  assert.deepEqual(result.run!.inputContext.conversation, [{ role: "user", content: "course details" }]);
});

test("Coach isolates skips and excludes orphaned historical facts", async () => {
  const repo = new InMemoryLightTickRepository();
  const a = await goalTask(repo), b = await goalTask(repo, owner, "Exercise");
  const service = new LightTickTaskService(repo, clock);
  await service.command(owner, b.task.id, b.task.version, { action: "skip", reason: "busy" });
  assert.deepEqual((await assembleChatContext(repo, owner, { goal_id: a.goal.id }, "none")).execution_facts.consecutive_skip_lineages, []);
  await service.command(owner, a.task.id, a.task.version, { action: "skip", reason: "busy" });
  // Pre-migration rows may be left without a task. A payload goal_id alone is not an ownership proof.
  (repo as any).events.push({ ...owner, id: "orphan", aggregateType: "task", aggregateId: "deleted-task", eventType: "task_completed",
    aggregateVersion: 1, occurredAt: clock().toISOString(), createdAt: clock().toISOString(),
    payload: { goal_id: a.goal.id, action: "complete", actual_minutes: 10, estimated_minutes: 10, title: "orphan secret" } });
  const facts = (await assembleChatContext(repo, owner, { goal_id: a.goal.id }, "none")).execution_facts;
  assert.equal(facts.completed_count, 0);
  assert.deepEqual(facts.consecutive_skip_lineages, [{ title: a.task.title, count: 1 }]);
});
