import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { readPlanningAgenda } from "../../src/modules/lighttick/planning/planning-agenda.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { readWeeklyPlanningCapacity, saveWeeklyPlanningCapacity } from "../../src/modules/lighttick/planning/weekly-capacity.ts";
import type { LightTickAtomicWrite } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickGoalRow, LightTickGuestIdentityRow } from "../../src/modules/lighttick/lighttick.types.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("LIGHTTICK_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
const owner = { appId: "lighttick", userId: "lighttick_pg_user" } as const;
const now = "2026-08-20T00:00:00.000Z";
const goal = (title: string): LightTickGoalRow => ({ ...owner, id: "lighttick_pg_goal", title,
  status: "active", constraints: {}, version: 1, createdAt: now, updatedAt: now });
const write = (suffix: string, version: number): LightTickAtomicWrite => ({
  event: { ...owner, id: `lighttick_pg_event_${suffix}`, aggregateType: "goal", aggregateId: "lighttick_pg_goal",
    eventType: "goal_updated", aggregateVersion: version, payload: {}, occurredAt: now, createdAt: now },
  change: { ...owner, entityType: "goal", entityId: "lighttick_pg_goal", entityVersion: version,
    operation: "upsert", snapshot: { suffix }, changedAt: now },
});

test("LightTick PostgreSQL migrations, ownership indexes, transactions, and concurrent CAS", async (suite) => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresLightTickRepository(pool);
  try {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1 OR device_id='lighttick_pg_device'", [owner.userId]);

    await suite.test("installs from empty and remains upgrade/idempotency safe", async () => {
      const installed = await pool.query(`SELECT name FROM zook_schema_migrations
        WHERE name LIKE '029_lighttick%' OR name LIKE '030_lighttick%' OR name LIKE '031_lighttick%'
          OR name LIKE '032_lighttick%' OR name LIKE '033_lighttick%' OR name LIKE '034_lighttick%' ORDER BY name`);
      assert.deepEqual(installed.rows.map(row => row.name), [
        "029_lighttick_core.sql", "030_lighttick_events_reviews_ai.sql", "031_lighttick_sync_devices.sql",
        "032_lighttick_progressive_action_loop.sql", "033_lighttick_guest_identities.sql",
        "034_lighttick_account_upgrades.sql",
      ]);
      const allBefore = await pool.query(`SELECT name FROM zook_schema_migrations ORDER BY name`);
      await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
      const allAfter = await pool.query(`SELECT name FROM zook_schema_migrations ORDER BY name`);
      assert.deepEqual(allAfter.rows, allBefore.rows);
    });

    await suite.test("retains stage outcomes and serializes concurrent roadmap writes across PostgreSQL connections", async () => {
      const member = { ...owner, userId: "lighttick_pg_roadmap" };
      const other = { ...owner, userId: "lighttick_pg_other_roadmap" };
      const clock = () => new Date("2026-11-29T12:00:00Z");
      const secondRepository = new PostgresLightTickRepository(pool);
      const goals = new LightTickGoalService(repository, clock);
      const writer = new GoalRoadmapService(repository, clock);
      const reader = new GoalRoadmapService(secondRepository, clock);
      const stage = { id: "report", title: "Prepare a practice report", outcome_criteria: "Explain one decision with evidence",
        starts_on: "2026-11-29", ends_on: "2026-12-06" };
      try {
        const goal = await goals.create(member, { title: "Work report", targetDate: "2026-12-30", constraints: { purpose: "Practice" } });
        const outcomes = await Promise.allSettled([
          writer.update(member, goal.id, { base_version: 0, stages: [stage] }),
          reader.update(member, goal.id, { base_version: 0, stages: [{ ...stage, title: "Prepare notes" }] }),
        ]);
        assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
        const rejected = outcomes.find(result => result.status === "rejected");
        assert.equal(rejected?.reason.code, "LIGHTTICK_VERSION_CONFLICT");
        assert.equal((await reader.get(member, goal.id)).version, 1);
        await assert.rejects(() => reader.get(other, goal.id), { code: "LIGHTTICK_RESOURCE_NOT_FOUND" });
        const recorded = await writer.recordOutcome(member, goal.id, stage.id, {
          base_version: 1, state: "achieved", note: "The report connects the decision and evidence.",
        });
        const reopened = await reader.recordOutcome(member, goal.id, stage.id, {
          base_version: 2, state: "reopened", note: "Practice the answer under a time constraint.",
        });
        assert.deepEqual(reopened.stages[0]?.outcome_history, [recorded.stages[0]?.outcome]);
        assert.deepEqual(await reader.get(member, goal.id), reopened);
        assert.equal((await repository.getGoal(member, goal.id))?.constraints.purpose, "Practice");
        const audit = (await repository.listExecutionEvents(member)).filter(event => event.eventType === "goal_roadmap_stage_outcome_recorded");
        assert.deepEqual(audit.map(event => event.payload.state).sort(), ["achieved", "reopened"]);
        assert.equal(audit[0]?.payload.outcome_criteria, stage.outcome_criteria);
        assert.equal((await repository.listPlans(member)).length, 0);
        assert.equal((await repository.listTasks(member)).length, 0);
      } finally {
        await repository.deleteOwnerData(member);
      }
    });

    await suite.test("serializes manual and conversational writes under a shared owner budget", async () => {
      const member = { ...owner, userId: "lighttick_pg_weekly_capacity" };
      const other = { ...owner, userId: "lighttick_pg_other_weekly_capacity" };
      const date = new Date("2026-11-25T08:00:00Z");
      const fixedClock = () => date;
      const secondRepository = new PostgresLightTickRepository(pool);
      const manual = new ManualPlanningService(repository, fixedClock);
      const goals = new LightTickGoalService(secondRepository, fixedClock);
      const conversational = new LightTickPlanService(secondRepository, fixedClock);
      const save = (base_version: number, weekly_available_minutes: number | null) =>
        repository.transaction(member, async () => {
          await repository.lockPlanningOwner(member);
          return saveWeeklyPlanningCapacity(repository, member, { base_version, weekly_available_minutes }, date);
        });
      try {
        assert.equal((await save(0, 100)).budget.version, 1);
        assert.equal((await save(1, 100)).budget.version, 2);
        assert.equal((await readWeeklyPlanningCapacity(secondRepository, other, date)).budget.version, 0);
        const manualDraft = await manual.create(member, "weekly-pg-manual-create", {
          title: "Practice explaining work", completion_criteria: "One example", period_start: "2026-11-23", period_end: "2026-11-29",
          tasks: [{ id: "exercise", title: "Practice explaining work", scheduled_for: "2026-11-28", estimated_minutes: 50,
            completion_criteria: "Done", guidance: "" }],
        });
        const assistantGoal = await goals.create(member, { title: "Course goal", constraints: {} });
        const assistantDraft = await conversational.createProposed(member, {
          goalId: assistantGoal.id, source: "deterministic_fixture", granularity: "week",
          periodStart: "2026-11-23", periodEnd: "2026-11-29",
          tasks: [{ title: "Read and summarize", scheduledFor: "2026-11-29", estimatedMinutes: 50 }],
        });
        const results = await Promise.allSettled([
          manual.confirm(member, manualDraft.id, "weekly-pg-manual-confirm", {
            base_version: manualDraft.version, goal_base_version: manualDraft.goal_version,
          }),
          conversational.confirm(member, assistantDraft.id, assistantDraft.version),
        ]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const rejected = results.find(result => result.status === "rejected");
        assert.equal(rejected?.reason.code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
        assert.equal((await repository.listTasks(member)).length, 1);
        assert.equal((await readWeeklyPlanningCapacity(secondRepository, member, date)).week.known_minutes, 50);
      } finally {
        await repository.deleteOwnerData(member);
      }
      assert.equal(await secondRepository.getWeeklyPlanningBudget(member), undefined);
    });

    await suite.test("reads account-dated plan agenda, including learning authority and legacy instants", async () => {
      const member = { ...owner, userId: "lighttick_pg_agenda" };
      const other = { ...owner, userId: "lighttick_pg_other_agenda" };
      const date = new Date("2026-12-01T07:30:00Z");
      const clock = () => date;
      const profile = new LightTickProfileService(repository, clock);
      const plans = new LightTickPlanService(repository, clock);
      try {
        await profile.updateProfile(member, 0, { timezone: "America/Los_Angeles" });
        const goal = await new LightTickGoalService(repository, clock).create(member, { title: "Agenda decisions", constraints: {} });
        const draft = await plans.createProposed(member, {
          goalId: goal.id, granularity: "week", source: "agenda_fixture", periodStart: "2026-11-28", periodEnd: "2026-11-30",
          tasks: [
            { title: "Legacy instant", estimatedMinutes: 10, scheduledFor: "2026-12-01T07:30:00Z" },
            { title: "Date-only task", estimatedMinutes: 20, scheduledFor: "2026-12-01" },
            { title: "Active course", estimatedMinutes: 15, scheduledFor: "2026-12-01" },
            { title: "Paused course", estimatedMinutes: 15, scheduledFor: "2026-12-01" },
            { title: "Undated task", estimatedMinutes: 15 },
          ],
        });
        const confirmed = await plans.confirm(member, draft.id, draft.version);
        const course = {
          ...member, revision: 1, publishedVersion: 1, updatedAt: date.toISOString(),
          brief: { title: "Course", goal: "Learn", level: "Intro", minutes: 15, pacing: "self_paced" as const },
          document: { prerequisites: "", stages: [], lessons: [] },
        };
        for (const status of ["active", "paused"] as const) {
          const route = { ...course, status, id: "agenda_course_" + status };
          await repository.learningRoutes.saveLearningRoute(route, 0);
          const task = confirmed.tasks.find(row => row.title.toLowerCase() === status + " course")!;
          await pool.query("UPDATE zook_lighttick_tasks SET lesson_source=$1::jsonb WHERE app_id=$2 AND user_id=$3 AND id=$4",
            [JSON.stringify({ route_id: route.id }), member.appId, member.userId, task.id]);
        }
        const agenda = (who = member) => readPlanningAgenda(repository, who, date, "2026-11-30", "2026-12-01");
        assert.deepEqual((await agenda()).items.map(row => [row.title, row.scheduled_date]), [
          ["Legacy instant", "2026-11-30"], ["Date-only task", "2026-12-01"],
        ]);
        await repository.saveLearningAuthority({ ...member, module: "learning", phase: "zook", epoch: 1, revision: 1,
          readingEnabled: true, privateEnabled: false, manifestHash: null, sourceBinding: null, updatedAt: date.toISOString() }, 0);
        const visible = (await agenda()).items;
        assert.equal(visible.length, 3);
        assert.equal(visible[0]?.title, "Legacy instant");
        assert.deepEqual(visible.slice(1).map(row => row.title).sort(), ["Active course", "Date-only task"]);
        assert.deepEqual((await agenda(other)).items, []);
      } finally {
        await repository.deleteOwnerData(member);
      }
    });

    await suite.test("creates owner and sync indexes", async () => {
      const indexes = await pool.query(`SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname=current_schema() AND indexname LIKE 'zook_lighttick_%'`);
      const definitions = indexes.rows.map(row => row.indexdef).join("\n");
      assert.match(definitions, /app_id, user_id/);
      assert.match(definitions, /zook_lighttick_changes_owner_sequence_idx/);
      assert.match(definitions, /zook_lighttick_operations_pkey/);
      assert.match(definitions, /zook_lighttick_devices_active_token_uidx/);
      assert.match(definitions, /zook_lighttick_tasks_owner_lineage_idx/);
      assert.match(definitions, /zook_lighttick_guest_expiry_idx/);
      assert.match(definitions, /zook_lighttick_account_upgrades_pkey/);
    });

    await suite.test("persists and recovers a device-bound guest identity", async () => {
      const guest: LightTickGuestIdentityRow = { ...owner, deviceId: "lighttick_pg_device",
        deviceSecretHash: "secret_hash", platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN",
        appVersion: "1.0.0", upgradeTokenHash: "upgrade_hash", expiresAt: "2026-09-20T00:00:00.000Z",
        createdAt: now, updatedAt: now };
      await repository.saveGuestIdentity(guest);
      assert.equal((await repository.getGuestIdentity(owner))?.deviceSecretHash, "secret_hash");
      assert.equal((await repository.getGuestIdentityByDevice("lighttick_pg_device"))?.userId, owner.userId);
    });

    await suite.test("rolls back failed owner transactions", async () => {
      await assert.rejects(repository.transaction(owner, async () => {
        await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
          onboardingState: "drafting", notificationPreferences: {}, onboardingDraft: {}, version: 1,
          createdAt: now, updatedAt: now });
        throw new Error("force rollback");
      }), /force rollback/);
      assert.equal(await repository.getProfile(owner), undefined);
    });

    await suite.test("replays one new planning goal under concurrent requests and lists only the owner's sessions", async () => {
      const member = { ...owner, userId: "lighttick_pg_planning_entry" };
      const planning = new LightTickPlanningService(repository, () => new Date(now));
      try {
        const create = () => planning.command(member, "planning-entry-same-key", "create", undefined, {
          goal_title: "保护草稿与待办边界",
        });
        const [first, retry] = await Promise.all([create(), create()]);
        assert.deepEqual(first, retry);
        const goals = await repository.listGoals(member);
        assert.equal(goals.length, 1);
        assert.equal(goals[0]!.status, "draft");
        assert.deepEqual(await repository.listPlans(member), []);
        assert.deepEqual(await repository.listTasks(member), []);
        assert.deepEqual(await repository.listPlanningSessions(member, 25, first.session.goalId), [{
          id: first.session.id, goalId: first.session.goalId, goalTitle: goals[0]!.title, status: "collecting",
          updatedAt: now, draftPlanId: null, draftExpiresAt: null, previousPlanId: null, periodStart: null, periodEnd: null,
        }]);
        assert.deepEqual(await repository.listPlanningSessions(member, 25), await repository.listPlanningSessions(member, 25, first.session.goalId));
        assert.deepEqual(await repository.listPlanningSessions(owner, 25, first.session.goalId), []);
        await planning.command(member, "save-planning-period", "context", first.session.id, {
          base_version: first.session.version,
          fields: {
            period_start: { value: "2026-08-24", source: "user" },
            period_end: { value: "2026-08-30", source: "confirmed" },
          },
        });
        const [datedSession] = await repository.listPlanningSessions(member, 25, first.session.goalId);
        assert.equal(datedSession?.periodStart, "2026-08-24");
        assert.equal(datedSession?.periodEnd, "2026-08-30");
      } finally {
        await repository.deleteOwnerData(member);
      }
      assert.deepEqual(await repository.listPlanningSessions(member, 25), []);
    });

    await suite.test("filters course collections and lessons before pagination", async () => {
      const learning = new (await import("../../src/modules/lighttick/learning/native-learning.service.ts")).NativeLearningService(repository, true);
      const member = { ...owner, userId: "lighttick_pg_module" };
      try {
        for (const [id, module] of [["aa-cognitive", "cognitive-reading"], ["bb-english", "english-reading"], ["cc-english", "english-reading"]]) {
          await learning.saveCollection(member, id, {
            base_revision: 0, module_id: module, title: id, description: "Module fixture", archived: false,
          }, "new-collection-" + id);
          await learning.publish(member, "lesson-" + id, {
            base_revision: 0, collection_id: id, number: 1, title: id, content: "Published", references: "",
          }, "publish-lesson-" + id);
        }
        const collections = await learning.collections(member, "", 1, "english-reading");
        assert.equal(collections.items[0].id, "bb-english");
        assert.ok(collections.next_cursor);
        assert.equal((await learning.collections(member, collections.next_cursor, 1, "english-reading")).items[0].id, "cc-english");
        const lessons = await learning.lessons(member, "", 1, undefined, "english-reading");
        assert.equal(lessons.items[0].module_id, "english-reading");
        assert.equal(lessons.items[0].id, "lesson-bb-english");
        assert.deepEqual((await learning.collections(owner, "", 1, "english-reading")).items, []);
      } finally {
        await repository.deleteOwnerData(member);
      }
    });

    await suite.test("persists, searches and removes private study notes with compare-and-swap writes", async () => {
      const member = { ...owner, userId: "lighttick_pg_notes" };
      const note = { kind: "renzhi" as const, course_id: "course-one", notes: "Test notes", answers: { a: "Evidence" }, revision: 1, updated_at: now };
      try {
        assert.deepEqual(await repository.saveStudyNote(member, note), note);
        assert.deepEqual(await repository.getStudyNote(member, note.kind, note.course_id), note);
        assert.equal(await repository.getStudyNote(owner, note.kind, note.course_id), undefined);
        const list = await repository.listStudyNotes(member, { q: "evidence", kind: "renzhi" });
        assert.equal(list.total, 1);
        assert.equal(list.items[0].title, note.notes);
        const edited = await repository.saveStudyNote(member, { ...note, notes: "Updated", revision: 2 });
        assert.equal(edited.revision, 2);
        await assert.rejects(repository.saveStudyNote(member, { ...note, revision: 2 }), { statusCode: 409 });
      } finally {
        await repository.deleteOwnerData(member);
      }
      assert.equal(await repository.getStudyNote(member, note.kind, note.course_id), undefined);
    });

    await suite.test("updates the materialized resource when an AI run completes", async () => {
      const queued = { ...owner, id: "lighttick_pg_ai_run", kind: "plan", status: "queued" as const,
        resourceId: "lighttick_pg_goal_before_materialization", sceneKey: "lighttick_plan_week",
        promptVersion: "v1", schemaVersion: "v1", attemptCount: 0, inputContext: {}, usage: {},
        createdAt: now, updatedAt: now };
      await repository.saveAiRun(queued);
      await repository.saveAiRun({ ...queued, status: "succeeded", resourceId: "lighttick_pg_plan_after_materialization",
        provider: "deterministic_template", attemptCount: 1, output: { tasks: [] }, updatedAt: now });

      assert.equal((await repository.getAiRun(owner, queued.id))?.resourceId,
        "lighttick_pg_plan_after_materialization");
      await pool.query("DELETE FROM zook_lighttick_ai_runs WHERE id=$1", [queued.id]);
    });

    await suite.test("updates a materialized review instead of duplicating its primary key", async () => {
      const review = { ...owner, id: "lighttick_pg_review", goalId: "lighttick_pg_review_goal", period: "week" as const,
        status: "ready", periodStart: "2026-08-17", periodEnd: "2026-08-23", facts: { event_count: 1 },
        output: {}, dataSufficiency: "insufficient", version: 1, createdAt: now, updatedAt: now };
      await repository.saveReview(review);
      await repository.saveReview({ ...review, output: { insights: ["kept"] }, dataSufficiency: "sufficient",
        version: 2, updatedAt: "2026-08-21T00:00:00.000Z" });

      const stored = (await repository.listReviews(owner)).find(item => item.id === review.id);
      assert.deepEqual(stored?.output, { insights: ["kept"] });
      assert.equal(stored?.version, 2);
      await pool.query("DELETE FROM zook_lighttick_reviews WHERE id=$1", [review.id]);
    });

    await suite.test("upgrades guest ownership atomically and replays the original result", async () => {
      const guestUserId = "lighttick_pg_upgrade_guest"; const targetUserId = "lighttick_pg_upgrade_target";
      await pool.query("DELETE FROM zook_lighttick_account_upgrades WHERE guest_user_id=$1", [guestUserId]);
      for (const table of ["zook_lighttick_operations","zook_lighttick_change_log","zook_lighttick_execution_events",
        "zook_lighttick_goals","zook_lighttick_profiles","zook_lighttick_guest_identities"])
        await pool.query(`DELETE FROM ${table} WHERE user_id IN ($1,$2)`, [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_users WHERE id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query(`INSERT INTO zook_users (id,password_hash,password_algo,status) VALUES
        ($1,'guest','lighttick-guest','ACTIVE'),($2,'formal','scrypt','ACTIVE')`, [guestUserId,targetUserId]);
      await pool.query(`INSERT INTO zook_app_users (id,app_id,user_id,status) VALUES
        ('app_user_pg_guest','lighttick',$1,'ACTIVE'),('app_user_pg_target','lighttick',$2,'ACTIVE')`, [guestUserId,targetUserId]);
      const guestOwner = { appId: "lighttick", userId: guestUserId } as const;
      const targetOwner = { appId: "lighttick", userId: targetUserId } as const;
      await repository.saveGuestIdentity({ ...guestOwner, deviceId: "lighttick_pg_upgrade_device",
        deviceSecretHash: "secret", platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN",
        appVersion: "1", upgradeTokenHash: "upgrade-proof", expiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: now, updatedAt: now });
      await repository.saveProfile({ ...guestOwner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
        onboardingState: "completed", notificationPreferences: {}, onboardingDraft: { source: "guest" }, version: 2,
        createdAt: now, updatedAt: now });
      await repository.saveProfile({ ...targetOwner, timezone: "Europe/Paris", locale: "fr-FR", pace: "relaxed",
        onboardingState: "drafting", notificationPreferences: { quiet: true }, onboardingDraft: { source: "target" }, version: 1,
        createdAt: now, updatedAt: now });
      await repository.saveGoal({ ...goal("upgrade-me"), ...guestOwner, id: "lighttick_pg_upgrade_goal" }, {
        event: { ...guestOwner, id: "lighttick_pg_upgrade_event", aggregateType: "goal",
          aggregateId: "lighttick_pg_upgrade_goal", eventType: "goal_created", aggregateVersion: 1,
          payload: {}, occurredAt: now, createdAt: now },
        change: { ...guestOwner, entityType: "goal", entityId: "lighttick_pg_upgrade_goal",
          entityVersion: 1, operation: "upsert", snapshot: {}, changedAt: now },
      });
      const command = { appId: "lighttick", operationId: "lighttick-pg-upgrade-operation", requestHash: "request-hash",
        guestUserId, targetUserId, guestUpgradeTokenHash: "upgrade-proof", deviceId: "lighttick_pg_upgrade_device",
        now: "2026-08-29T00:00:00.000Z" } as const;
      const upgraded = await repository.upgradeGuestAccount(command);
      assert.equal(upgraded.transferredResourceCounts.goals, 1);
      assert.equal((await repository.getGoal(targetOwner, "lighttick_pg_upgrade_goal"))?.userId, targetUserId);
      assert.equal((await repository.getGuestIdentity(guestOwner))?.upgradedToUserId, targetUserId);
      const mergedProfile = await repository.getProfile(targetOwner);
      assert.equal(mergedProfile?.timezone, "Europe/Paris");
      assert.equal(mergedProfile?.onboardingState, "completed");
      assert.equal((await repository.upgradeGuestAccount(command)).idempotencyReplayed, true);
      const mismatch = { ...command, requestHash: "changed-request" };
      await assert.rejects(repository.upgradeGuestAccount(mismatch), (error: any) => error.code === "LIGHTTICK_IDEMPOTENCY_MISMATCH");
      await repository.deleteOwnerData(targetOwner);
      assert.equal(await repository.getGoal(targetOwner, "lighttick_pg_upgrade_goal"), undefined);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM zook_lighttick_account_upgrades WHERE target_user_id=$1",
        [targetUserId])).rows[0].count, 0);
      for (const table of ["zook_lighttick_change_log","zook_lighttick_execution_events","zook_lighttick_goals",
        "zook_lighttick_profiles","zook_lighttick_guest_identities"])
        await pool.query(`DELETE FROM ${table} WHERE user_id IN ($1,$2)`, [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id IN ($1,$2)", [guestUserId,targetUserId]);
      await pool.query("DELETE FROM zook_users WHERE id IN ($1,$2)", [guestUserId,targetUserId]);
    });

    await suite.test("rejects a guest aggregate that references a third-party owner and rolls back", async () => {
      const guestUserId = "lighttick_pg_security_guest";
      const targetUserId = "lighttick_pg_security_target";
      const thirdUserId = "lighttick_pg_security_third";
      const userIds = [guestUserId, targetUserId, thirdUserId];
      try {
        await pool.query(`INSERT INTO zook_users (id,password_hash,password_algo,status) VALUES
          ($1,'guest','lighttick-guest','ACTIVE'),($2,'formal','scrypt','ACTIVE'),($3,'third','scrypt','ACTIVE')
          ON CONFLICT (id) DO NOTHING`, userIds);
        await pool.query(`INSERT INTO zook_app_users (id,app_id,user_id,status) VALUES
          ('app_user_pg_security_guest','lighttick',$1,'ACTIVE'),
          ('app_user_pg_security_target','lighttick',$2,'ACTIVE'),
          ('app_user_pg_security_third','lighttick',$3,'ACTIVE') ON CONFLICT DO NOTHING`, userIds);
        await repository.saveGuestIdentity({ appId: "lighttick", userId: guestUserId,
          deviceId: "lighttick_pg_security_device", deviceSecretHash: "secret", platform: "android",
          timezone: "Asia/Shanghai", locale: "zh-CN", appVersion: "1", upgradeTokenHash: "security-proof",
          expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now, updatedAt: now });
        await pool.query(`INSERT INTO zook_lighttick_goals
          (id,app_id,user_id,title,status,constraints,version,created_at,updated_at)
          VALUES ('lighttick_pg_third_goal','lighttick',$1,'third goal','active','{}',1,$2,$2)`, [thirdUserId, now]);
        await pool.query(`INSERT INTO zook_lighttick_plan_cycles
          (id,app_id,user_id,goal_id,granularity,status,source,period_start,period_end,proposal,version,created_at,updated_at)
          VALUES ('lighttick_pg_foreign_plan','lighttick',$1,'lighttick_pg_third_goal','week','active','user',
          '2026-08-24','2026-08-30','{}',1,$2,$2)`, [guestUserId, now]);

        await assert.rejects(repository.upgradeGuestAccount({ appId: "lighttick",
          operationId: "lighttick-pg-security-upgrade", requestHash: "security-request", guestUserId,
          targetUserId, guestUpgradeTokenHash: "security-proof", deviceId: "lighttick_pg_security_device",
          now: "2026-08-29T00:00:00.000Z" }),
        (error: any) => error.code === "LIGHTTICK_GUEST_UPGRADE_CONFLICT");
        assert.equal((await pool.query("SELECT user_id FROM zook_lighttick_plan_cycles WHERE id='lighttick_pg_foreign_plan'"))
          .rows[0]?.user_id, guestUserId);
        assert.equal((await repository.getGuestIdentity({ appId: "lighttick", userId: guestUserId }))?.revokedAt, null);
      } finally {
        await pool.query("DELETE FROM zook_lighttick_plan_cycles WHERE id='lighttick_pg_foreign_plan'");
        await pool.query("DELETE FROM zook_lighttick_goals WHERE id='lighttick_pg_third_goal'");
        await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1", [guestUserId]);
        await pool.query("DELETE FROM zook_lighttick_account_upgrades WHERE operation_id='lighttick-pg-security-upgrade'");
        await pool.query("DELETE FROM zook_app_users WHERE app_id='lighttick' AND user_id=ANY($1::text[])", [userIds]);
        await pool.query("DELETE FROM zook_users WHERE id=ANY($1::text[])", [userIds]);
      }
    });

    await suite.test("allows exactly one concurrent update for one base version", async () => {
      await repository.saveGoal(goal("base"), write("create", 1));
      const outcomes = await Promise.allSettled([
        repository.saveGoal(goal("left"), write("left", 2), 1),
        repository.saveGoal(goal("right"), write("right", 2), 1),
      ]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "LIGHTTICK_VERSION_CONFLICT");
      const stored = await repository.getGoal(owner, "lighttick_pg_goal");
      assert.equal(stored?.version, 2);
      const events = await pool.query(`SELECT id FROM zook_lighttick_execution_events
        WHERE app_id=$1 AND user_id=$2 AND aggregate_id='lighttick_pg_goal'`, [owner.appId,owner.userId]);
      assert.equal(events.rowCount, 2);
    });
  } finally {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_guest_identities WHERE user_id=$1 OR device_id='lighttick_pg_device'", [owner.userId]).catch(() => undefined);
    await pool.end();
  }
});
