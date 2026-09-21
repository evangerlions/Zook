import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { assembleChatContext } from "../../src/modules/lighttick/ai/lighttick-ai-context.ts";
const connectionString = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Use a disposable LIGHTTICK_TEST_DATABASE_URL");
await runPostgresMigrations({ connectionString, log: () => undefined });
const pool = new Pool({ connectionString });
after(() => pool.end());
test("PostgreSQL filters goal history before LIMIT and Coach excludes other goals/accounts", async () => {
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "coach-isolation-test" };
  const other = { ...owner, userId: "coach-isolation-other" };
  await repo.deleteOwnerData(owner); await repo.deleteOwnerData(other);
  const clock = () => new Date("2026-09-21T08:00:00Z");
  const fixtures = [];
  for (const [index, who] of [owner, owner, other].entries()) {
    const goal = await new LightTickGoalService(repo, clock).create(who, { title: `Goal ${index}`, constraints: {} });
    const plans = new LightTickPlanService(repo, clock);
    const plan = await plans.createProposed(who, { goalId: goal.id, granularity: "week", periodStart: "2026-09-21", periodEnd: "2026-09-27", source: "ai",
      tasks: [{ title: `Task ${index}`, estimatedMinutes: 10, priority: 1, scheduledFor: "2026-09-21" }] });
    await plans.confirm(who, plan.id, plan.version);
    const task = (await repo.listTasks(who, plan.id))[0];
    await new LightTickTaskService(repo, clock).command(who, task.id, task.version, { action: "complete", actualMinutes: 12 + index * 100 });
    await repo.saveChatMessage({ ...who, id: `scope-msg-${index}`, goalId: goal.id, threadId: "same-thread", role: "user", content: `Goal ${index} only`, createdAt: `2026-09-21T08:0${index}:00Z` });
    fixtures.push({ goal, task, plan });
  }
  const current = fixtures[0];
  const history = await repo.listChatMessages(owner, "same-thread", 1, current.goal.id);
  assert.deepEqual(history.map(m => m.content), ["Goal 0 only"]);
  const context = await assembleChatContext(repo, owner, { goal_id: current.goal.id }, "same-thread", 1);
  assert.equal(context.execution_facts.completed_count, 1);
  assert.equal(context.execution_facts.average_deviation_minutes, 2);
  assert.deepEqual(context.conversation, [{ role: "user", content: "Goal 0 only" }]);
  await assert.rejects(assembleChatContext(repo, owner, { goal_id: current.goal.id, task_id: fixtures[1].task.id }, "same-thread"), { code: "LIGHTTICK_PLAN_CONSTRAINT_FAILED" });
  await assert.rejects(assembleChatContext(repo, owner, { goal_id: current.goal.id, task_id: fixtures[2].task.id }, "same-thread"), { code: "LIGHTTICK_RESOURCE_NOT_FOUND" });
  // Ties have a stable ordering, in the same direction as the in-memory adapter.
  await repo.saveChatMessage({ ...owner, id: "scope-msg-z", goalId: current.goal.id, threadId: "same-thread", role: "assistant", content: "latest tied", createdAt: "2026-09-21T08:00:00Z" });
  assert.equal((await repo.listChatMessages(owner, "same-thread", 1, current.goal.id))[0].id, "scope-msg-z");
  await runPostgresMigrations({ connectionString, log: () => undefined });
  assert.equal((await repo.listChatMessages(owner, "same-thread", 2, current.goal.id)).length, 2);
});
