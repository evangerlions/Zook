import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { GoalConditionsService } from "../../src/modules/lighttick/goal-context/goal-conditions.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickProposalService } from "../../src/modules/lighttick/lighttick-proposal.service.ts";
import { LightTickReflectionService } from "../../src/modules/lighttick/lighttick-reflection.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { handleReflectionRequest } from "../../src/app/lighttick-reflection-routes.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import type { ManualAction, ManualDraft } from "../../src/modules/lighttick/manual/manual-planning.types.ts";

const connectionString = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!connectionString) throw new Error("A disposable LIGHTTICK_TEST_DATABASE_URL is required.");
const target = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/native_continuation.*qa/.test(target.pathname))
  throw new Error("Use a dedicated loopback native_continuation QA database for this fixture.");
const now = "2026-10-31T04:00:00.000Z", clock = () => new Date(now);
const action = (id: string, minutes: number | null = 10, date: string | null = "2026-11-01"): ManualAction => ({
  id, title: id, scheduled_for: date, estimated_minutes: minutes, completion_criteria: "One concrete example", guidance: "",
});
const draftInput = (tasks: ManualAction[] = [action("existing-action")]): ManualDraft => ({ title: "Explain clearly",
  completion_criteria: "Explain one example", period_start: "2026-11-01", period_end: "2026-11-07", tasks });

test("N3 continuation and conditions use real PostgreSQL transactions and durable receipts", async (t) => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString, max: 12 });
  const repository = new PostgresLightTickRepository(pool);
  const owners: LightTickOwner[] = [];
  const client = () => new PostgresLightTickRepository(pool);
  const createOwner = (label: string): LightTickOwner => {
    const owner: LightTickOwner = { appId: "lighttick", userId: `n3-pg-${label}-${randomUUID()}` };
    owners.push(owner); return owner;
  };
  const snapshot = async (owner: LightTickOwner) => ({
    goals: (await repository.listGoals(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    plans: (await repository.listPlans(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    tasks: (await repository.listTasks(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    reflections: (await repository.listReflections(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    proposals: (await repository.listProposals(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    events: (await repository.listExecutionEvents(owner)).sort((a, b) => a.id.localeCompare(b.id)),
    changes: await repository.pullChanges(owner, 0, 1000),
    operations: (await pool.query("SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 ORDER BY operation_id", [owner.appId, owner.userId])).rows,
  });
  const setup = async (label: string, tasks?: ManualAction[]) => {
    const owner = createOwner(label), manual = new ManualPlanningService(repository, clock);
    const draft = await manual.create(owner, "initial-create", draftInput(tasks));
    const plan = await manual.confirm(owner, draft.id, "initial-confirm", { base_version: draft.version, goal_base_version: draft.goal_version });
    const goals = new LightTickGoalService(repository, clock), taskService = new LightTickTaskService(repository, clock);
    const reflect = async () => new LightTickReflectionService(repository, clock).save(owner, `reflection-${randomUUID()}`, {
      goal_id: plan.goal_id, plan_id: plan.id, period_start: "2026-10-31", period_end: "2026-10-31",
      content: "A smaller example helped", next_action: "Review the next example", base_version: 0,
    });
    const confirm = async (id: string, key: string) => {
      const draft = await manual.get(owner, id);
      return new ManualPlanningService(client(), clock).confirm(owner, id, key, {
        base_version: draft.version, goal_base_version: (await goals.get(owner, draft.goal_id)).version,
      });
    };
    return { owner, manual, plan, goals, taskService, reflect, confirm };
  };
  try {
    await t.test("condition corrections, scoped temporary invalidation and original receipt survive reconnect", async () => {
      const { owner, plan, goals } = await setup("conditions");
      const service = new GoalConditionsService(repository, clock);
      const ongoing = { id: "ongoing-budget", condition_version: 0, base_version: plan.goal_version,
        scope: "ongoing", starts_on: "2026-10-31", ends_on: null, daily_minutes: 30, active: true, reason: "Available daily minutes" };
      const first = await service.confirm(owner, plan.goal_id, "condition-original", ongoing);
      const corrected = await service.confirm(owner, plan.goal_id, "condition-correct", { ...ongoing,
        base_version: first.goal.version, condition_version: 1, daily_minutes: 20, reason: "Corrected available minutes" });
      const temporary = { id: "temporary-first", condition_version: 0, base_version: corrected.goal.version,
        scope: "temporary", starts_on: "2026-11-01", ends_on: "2026-11-02", daily_minutes: 10, active: true, reason: "Temporary window" };
      const temp1 = await service.confirm(owner, plan.goal_id, "temporary-first", temporary);
      const temp2 = await service.confirm(owner, plan.goal_id, "temporary-second", { ...temporary, id: "temporary-second", base_version: temp1.goal.version, daily_minutes: 5 });
      const beforeInvalid = await service.context(owner, plan.goal_id, "2026-11-01", "2026-11-03");
      assert.deepEqual(beforeInvalid.daily_limits.map(d => d.minutes), [5, 5, 20]);
      const beforeBadWindow = await snapshot(owner);
      await assert.rejects(service.confirm(owner, plan.goal_id, "temporary-bad-window", { ...temporary,
        id: "temporary-second", base_version: temp2.goal.version, condition_version: 1, active: false,
        daily_minutes: null, starts_on: "2026-11-02" }), { statusCode: 422 });
      assert.deepEqual(await snapshot(owner), beforeBadWindow);
      const revokedTemp = await service.confirm(owner, plan.goal_id, "temporary-revoke", { ...temporary,
        id: "temporary-second", base_version: temp2.goal.version, condition_version: 1, active: false, daily_minutes: null });
      assert.deepEqual((await service.context(owner, plan.goal_id, "2026-11-01", "2026-11-03")).daily_limits.map(d => d.minutes), [20, 20, 20]);
      await service.confirm(owner, plan.goal_id, "ongoing-revoke", { ...ongoing,
        base_version: revokedTemp.goal.version, condition_version: 2, active: false, daily_minutes: null });
      const beforeReplay = await snapshot(owner);
      const reconnectPool = new Pool({ connectionString, max: 2 });
      try {
        const reconnect = new GoalConditionsService(new PostgresLightTickRepository(reconnectPool), clock);
        assert.deepEqual(await reconnect.confirm(owner, plan.goal_id, "condition-original", ongoing), first);
        const context = await reconnect.context(owner, plan.goal_id, "2026-11-01", "2026-11-03");
        assert.deepEqual(context.daily_limits.map(d => d.minutes), [null, null, null]);
        assert.equal(context.conditions.length, 6);
        assert.equal(context.conditions[0].daily_minutes, 30);
        await assert.rejects(reconnect.confirm(owner, plan.goal_id, "condition-original", { ...ongoing, daily_minutes: 99 }), { statusCode: 409 });
      } finally { await reconnectPool.end(); }
      assert.deepEqual(await snapshot(owner), beforeReplay);
      assert.equal((await goals.get(owner, plan.goal_id)).status, "active");
      const foreign = createOwner("foreign-condition");
      await assert.rejects(service.context(foreign, plan.goal_id, "2026-11-01", "2026-11-01"), { statusCode: 404 });
    });

    await t.test("concurrent condition corrections use CAS and competing confirmations cannot overbook", async () => {
      const { owner, manual, plan, goals } = await setup("capacity-race");
      const initial = { id: "capacity-budget", condition_version: 0, base_version: plan.goal_version,
        scope: "ongoing", starts_on: "2026-11-01", ends_on: null, daily_minutes: 30, active: true, reason: "Daily capacity" };
      const first = await new GoalConditionsService(repository, clock).confirm(owner, plan.goal_id, "capacity-first", initial);
      const results = await Promise.allSettled([20, 20].map((minutes, i) => new GoalConditionsService(client(), clock).confirm(owner, plan.goal_id,
        `capacity-correct-${i}`, { ...initial, base_version: first.goal.version, condition_version: 1, daily_minutes: minutes, reason: `Correction ${i}` })));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected" && r.reason.statusCode === 409).length, 1);
      const conditionState = await new GoalConditionsService(repository, clock).context(owner, plan.goal_id, "2026-11-01", "2026-11-01");
      assert.equal(conditionState.conditions.length, 2);
      const drafts = await Promise.all(["first-addition", "second-addition"].map((name, i) => manual.create(owner,
        `capacity-draft-${i}`, { ...draftInput([action(name)]), goal_id: plan.goal_id })));
      const goalVersion = (await goals.get(owner, plan.goal_id)).version;
      const confirmations = await Promise.allSettled(drafts.map((d, i) => new ManualPlanningService(client(), clock).confirm(owner, d.id,
        `capacity-confirm-${i}`, { base_version: d.version, goal_base_version: goalVersion })));
      assert.equal(confirmations.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(confirmations.filter(r => r.status === "rejected" && [409, 422].includes(r.reason.statusCode)).length, 1);
      assert.equal((await repository.listTasks(owner)).length, 2);
      assert.equal((await new GoalConditionsService(repository, clock).context(owner, plan.goal_id, "2026-11-01", "2026-11-01")).daily_limits[0].known_minutes, 20);
    });

    await t.test("reflection PUT original logical request replays its accepted version after a correction", async () => {
      const { owner, plan } = await setup("reflection-replay");
      const id = `reflection-${randomUUID()}`, path = `/api/v1/lighttick/reflections/${id}`;
      const body = { goal_id: plan.goal_id, plan_id: plan.id, period_start: "2026-10-31", period_end: "2026-10-31",
        content: "First observation", next_action: "First suggestion", base_version: 0 };
      const first = await handleReflectionRequest(repository, owner, { method: "PUT", path, headers: {}, body });
      await handleReflectionRequest(client(), owner, { method: "PUT", path, headers: {}, body: { ...body, base_version: 1, content: "Corrected observation" } });
      const before = await snapshot(owner);
      assert.deepEqual(await handleReflectionRequest(client(), owner, { method: "PUT", path, headers: {}, body }), first);
      assert.equal((await repository.listReflections(owner))[0].version, 2);
      await assert.rejects(handleReflectionRequest(client(), owner, { method: "PUT", path, headers: {}, body: { ...body, next_action: "Different request" } }), { statusCode: 409 });
      assert.deepEqual(await snapshot(owner), before);
      assert.equal((await repository.listTasks(owner)).length, 1);
    });

    await t.test("one reflection revision is consumed once across concurrent requests, supersession and receipt replay", async () => {
      const { owner, manual, plan, goals, reflect, confirm } = await setup("source-race");
      const reflection = await reflect();
      const drafts = await Promise.all(["next-one", "next-two"].map((name, i) => manual.create(owner, `source-create-${i}`,
        { ...draftInput([action(name, 5)]), goal_id: plan.goal_id, source_reflection_id: reflection.id, source_reflection_version: reflection.version })));
      const commands = drafts.map(d => ({ base_version: d.version, goal_base_version: d.goal_version }));
      const results = await Promise.allSettled(drafts.map((d, i) => new ManualPlanningService(client(), clock).confirm(owner, d.id, `source-confirm-${i}`, commands[i])));
      const winner = results.findIndex(r => r.status === "fulfilled"), loser = winner === 0 ? 1 : 0;
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected" && r.reason.statusCode === 409).length, 1);
      const accepted = (results[winner] as PromiseFulfilledResult<Awaited<ReturnType<ManualPlanningService["confirm"]>>>).value;
      const beforeReuse = await snapshot(owner);
      await assert.rejects(confirm(drafts[loser].id, "source-reuse-current-version"), { statusCode: 409 });
      assert.deepEqual(await snapshot(owner), beforeReuse);
      const offered = await repository.saveProposal({ ...owner, id: `proposal-${randomUUID()}`, planId: accepted.id,
        basePlanVersion: accepted.version, status: "pending", reason: "Reviewed effort adjustment",
        diff: [{ action: "update_task", task_id: accepted.tasks[0].id, estimated_minutes: 6 }], impact: {},
        expiresAt: "2026-11-07T00:00:00.000Z", version: 1, createdAt: now, updatedAt: now });
      await new LightTickProposalService(client(), clock).accept(owner, offered.id, offered.version);
      assert.equal((await repository.getPlan(owner, accepted.id))?.status, "superseded");
      const beforeReplay = await snapshot(owner);
      await assert.rejects(confirm(drafts[loser].id, "source-reuse-after-supersession"), { statusCode: 409 });
      assert.deepEqual(await new ManualPlanningService(client(), clock).confirm(owner, drafts[winner].id,
        `source-confirm-${winner}`, commands[winner]), accepted);
      assert.deepEqual(await snapshot(owner), beforeReplay);
      assert.equal((await repository.listTasks(owner)).length, 2);
      assert.equal((await goals.get(owner, plan.goal_id)).status, "active");
    });

    await t.test("stale reflection and task revisions cannot partially cancel or consume a continuation", async () => {
      const { owner, manual, plan, reflect, taskService, confirm } = await setup("stale-source");
      const reflection = await reflect(), selected = (await repository.listTasks(owner))[0];
      const draft = await manual.create(owner, "stale-create", { ...draftInput([action("reviewed-replacement")]), goal_id: plan.goal_id,
        source_reflection_id: reflection.id, source_reflection_version: reflection.version,
        replace_tasks: [{ id: selected.id, version: selected.version }] });
      await new LightTickReflectionService(client(), clock).save(owner, reflection.id, { goal_id: plan.goal_id, plan_id: plan.id,
        period_start: reflection.periodStart, period_end: reflection.periodEnd, content: "Newer source revision", next_action: reflection.nextAction, base_version: reflection.version });
      const beforeSource = await snapshot(owner);
      await assert.rejects(confirm(draft.id, "stale-source-confirm"), { statusCode: 409 });
      assert.deepEqual(await snapshot(owner), beforeSource);
      const taskDraft = await manual.create(owner, "stale-task-create", { ...draftInput([action("task-replacement")]), goal_id: plan.goal_id,
        replace_tasks: [{ id: selected.id, version: selected.version }] });
      await taskService.command(owner, selected.id, selected.version, { action: "start" });
      const beforeTask = await snapshot(owner);
      await assert.rejects(confirm(taskDraft.id, "stale-task-confirm"), { statusCode: 409 });
      assert.deepEqual(await snapshot(owner), beforeTask);
      assert.equal(await repository.getOperation(owner, "stale-source-confirm"), undefined);
      assert.equal(await repository.getOperation(owner, "stale-task-confirm"), undefined);
    });

    await t.test("source reflection and replacement references remain owner and goal scoped on real rows", async () => {
      const own = await setup("source-owner"), foreign = await setup("foreign-source");
      const foreignReflection = await foreign.reflect(), foreignTask = (await repository.listTasks(foreign.owner))[0];
      const otherGoal = await own.goals.create(own.owner, { title: "Another owned goal", constraints: {} });
      const otherReflection = await new LightTickReflectionService(repository, clock).save(own.owner, `reflection-${randomUUID()}`, {
        goal_id: otherGoal.id, period_start: "2026-10-31", period_end: "2026-10-31", content: "Another goal observation", base_version: 0,
      });
      for (const [name, extension] of [
        ["foreign-reflection", { source_reflection_id: foreignReflection.id, source_reflection_version: foreignReflection.version }],
        ["foreign-goal-reflection", { source_reflection_id: otherReflection.id, source_reflection_version: otherReflection.version }],
        ["foreign-task", { replace_tasks: [{ id: foreignTask.id, version: foreignTask.version }] }],
      ] as const) {
        const before = await snapshot(own.owner), beforeForeign = await snapshot(foreign.owner);
        await assert.rejects(own.manual.create(own.owner, `invalid-${name}`, { ...draftInput([action(name)]), goal_id: own.plan.goal_id, ...extension }), { statusCode: 404 });
        assert.deepEqual(await snapshot(own.owner), before);
        assert.deepEqual(await snapshot(foreign.owner), beforeForeign);
      }
    });

    await t.test("local business dates and unknown effort survive persistence without shifting midnight capacity", async () => {
      const { owner, manual, plan, goals, confirm } = await setup("timezone");
      await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
        onboardingState: "completed", notificationPreferences: {}, onboardingDraft: {}, version: 1, createdAt: now, updatedAt: now });
      const legacy = new LightTickPlanService(repository, clock);
      const late = await legacy.createProposed(owner, { goalId: plan.goal_id, granularity: "week", source: "template",
        periodStart: "2026-11-01", periodEnd: "2026-11-07", tasks: [{ title: "Late UTC action", estimatedMinutes: 7, scheduledFor: "2026-11-01T16:30:00.000Z" }] });
      await legacy.confirm(owner, late.id, late.version);
      const conditions = new GoalConditionsService(repository, clock);
      await conditions.confirm(owner, plan.goal_id, "timezone-budget", { id: "timezone-budget", condition_version: 0,
        base_version: (await goals.get(owner, plan.goal_id)).version, scope: "ongoing", starts_on: "2026-11-01", ends_on: null,
        daily_minutes: 15, active: true, reason: "Local day budget" });
      const context = await conditions.context(owner, plan.goal_id, "2026-11-01", "2026-11-02");
      assert.equal(context.timezone, "Asia/Shanghai");
      assert.deepEqual(context.daily_limits.map(d => d.known_minutes), [10, 7]);
      const over = await manual.create(owner, "timezone-over-create", { ...draftInput([action("over-local-midnight", 10, "2026-11-02")]), goal_id: plan.goal_id });
      const before = await snapshot(owner);
      await assert.rejects(confirm(over.id, "timezone-over-confirm"), { statusCode: 422 });
      assert.deepEqual(await snapshot(owner), before);
      const unknown = await manual.create(owner, "timezone-unknown-create", { ...draftInput([action("unknown-local-day", null, "2026-11-02")]), goal_id: plan.goal_id });
      const result = await confirm(unknown.id, "timezone-unknown-confirm");
      const saved = (await client().getTask(owner, result.tasks[0].id))!;
      assert.equal(saved.scheduledFor, "2026-11-02");
      assert.equal(saved.estimatedMinutes, null);
      const after = await new GoalConditionsService(client(), clock).context(owner, plan.goal_id, "2026-11-01", "2026-11-02");
      assert.deepEqual(after.daily_limits.map(d => [d.known_minutes, d.unknown_count]), [[10, 0], [7, 1]]);
    });

    await t.test("reviewed resume covers dated and undated outstanding work, rolls back on failure, and replays once", async () => {
      const { owner, manual, plan, goals, taskService, reflect, confirm } = await setup("resume", [action("completed-work"), action("in-progress-work"), action("undated-work", null, null)]);
      const initial = await repository.listTasks(owner);
      const done = initial.find(task => task.title === "completed-work")!, pending = initial.find(task => task.title === "in-progress-work")!;
      const completed = await taskService.command(owner, done.id, done.version, { action: "complete", actualMinutes: 7, notes: "Historical evidence" });
      const started = await taskService.command(owner, pending.id, pending.version, { action: "start" });
      const reflection = await reflect();
      const paused = await goals.transition(owner, plan.goal_id, (await goals.get(owner, plan.goal_id)).version, "pause");
      const beforeIncomplete = await snapshot(owner);
      await assert.rejects(manual.create(owner, "incomplete-resume", { ...draftInput([action("reviewed-restart")]), goal_id: plan.goal_id, resume_goal: true,
        replace_tasks: [{ id: started.id, version: started.version }] }), { statusCode: 409 });
      await assert.rejects(goals.transition(owner, plan.goal_id, paused.version, "resume"), { statusCode: 409 });
      assert.deepEqual(await snapshot(owner), beforeIncomplete);
      const outstanding = (await repository.listTasks(owner)).filter(task => ["pending", "in_progress"].includes(task.status));
      const draft = await manual.create(owner, "resume-create", { ...draftInput([{ ...action("explicit-restart", null), source_task_id: started.id }]),
        goal_id: plan.goal_id, resume_goal: true, replace_tasks: outstanding.map(task => ({ id: task.id, version: task.version })),
        source_reflection_id: reflection.id, source_reflection_version: reflection.version });
      const command = { base_version: draft.version, goal_base_version: draft.goal_version };
      const beforeFailure = await snapshot(owner), saveTask = repository.saveTask.bind(repository);
      repository.saveTask = async (...args) => {
        if (args[0].planId === draft.id) throw new Error("injected N3 materialization failure");
        return saveTask(...args);
      };
      try {
        await assert.rejects(manual.confirm(owner, draft.id, "resume-confirm", command), /injected N3 materialization failure/);
      } finally { repository.saveTask = saveTask; }
      assert.deepEqual(await snapshot(owner), beforeFailure);
      assert.equal(await repository.getOperation(owner, "resume-confirm"), undefined);
      const result = await confirm(draft.id, "resume-confirm");
      assert.equal((await goals.get(owner, plan.goal_id)).status, "active");
      for (const old of outstanding) assert.equal((await repository.getTask(owner, old.id))?.status, "cancelled");
      assert.deepEqual(await repository.getTask(owner, completed.id), completed);
      assert.equal(result.tasks.length, 1);
      const created = (await repository.getTask(owner, result.tasks[0].id))!;
      assert.equal(created.lineageId, started.lineageId ?? started.id);
      assert.equal(created.estimatedMinutes, null);
      const after = await snapshot(owner);
      assert.deepEqual(await new ManualPlanningService(client(), clock).confirm(owner, draft.id, "resume-confirm", command), result);
      assert.deepEqual(await snapshot(owner), after);
      const today = await new LightTickTodayService(repository, () => new Date("2026-11-01T04:00:00Z")).get(owner);
      assert.deepEqual(today.executableTasks.map(task => task.id), [created.id]);
    });

    for (const lifecycle of ["pause", "complete", "archive"] as const) {
      await t.test(`stopped goal ${lifecycle} rejects native execution and legacy confirmations atomically`, async () => {
        const { owner, manual, plan, goals, taskService, confirm } = await setup(`stopped-${lifecycle}`);
        const task = (await repository.listTasks(owner))[0];
        const next = await manual.create(owner, "cached-native-create", { ...draftInput([action("cached-native-action")]), goal_id: plan.goal_id });
        const plans = new LightTickPlanService(repository, clock);
        const legacy = await plans.createProposed(owner, { goalId: plan.goal_id, granularity: "week", source: "template",
          periodStart: "2026-11-01", periodEnd: "2026-11-07", tasks: [{ title: "Cached legacy action", estimatedMinutes: 5, scheduledFor: "2026-11-01" }] });
        const offered = await repository.saveProposal({ ...owner, id: `proposal-${randomUUID()}`, planId: plan.id, basePlanVersion: plan.version,
          status: "pending", reason: "Cached proposal", diff: [{ action: "update_task", task_id: task.id, estimated_minutes: 5 }], impact: {},
          expiresAt: "2026-11-07T00:00:00.000Z", version: 1, createdAt: now, updatedAt: now });
        await goals.transition(owner, plan.goal_id, (await goals.get(owner, plan.goal_id)).version, lifecycle);
        const before = await snapshot(owner);
        await assert.rejects(taskService.command(owner, task.id, task.version, { action: "start" }), { statusCode: 409 });
        await assert.rejects(taskService.command(owner, task.id, task.version, { action: "complete" }), { statusCode: 409 });
        await assert.rejects(confirm(next.id, "stopped-native-confirm"), { statusCode: 409 });
        await assert.rejects(plans.confirm(owner, legacy.id, legacy.version), { statusCode: 409 });
        await assert.rejects(new LightTickProposalService(client(), clock).accept(owner, offered.id, offered.version), { statusCode: 409 });
        assert.deepEqual(await snapshot(owner), before);
      });
    }
  } finally {
    for (const owner of owners) await repository.deleteOwnerData(owner);
    await pool.end();
  }
});
