import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedTodayFocus } from "../support/today-focus-fixture.ts";
import { WeeklyCardService } from "../../src/modules/lighttick/weekly-cards/weekly-card.service.ts";
import { TodayFocusService } from "../../src/modules/lighttick/today-focus/today-focus.service.ts";
import { DailyRhythmService } from "../../src/modules/lighttick/today-focus/daily-rhythm.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_weekly_")
)
  throw Error("Dedicated localhost weekly DB required");
const o = { appId: "lighttick", userId: "user_alice" };
const ref = (t: any) =>
  Object.fromEntries(
    [
      "task_id",
      "task_version",
      "plan_id",
      "plan_version",
      "goal_id",
      "goal_version",
    ].map((k) => [k, t[k]]),
  );
async function setup() {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    ...o,
    id: "weekly-alice",
    status: "ACTIVE",
    accountRegion: "CN",
    joinedAt: new Date().toISOString(),
  });
  await repo.deleteOwnerData(o);
  const app = await createApplication({
      seed,
      lighttickEnabled: true,
      lighttickRepository: repo,
    }),
    f = await seedTodayFocus(app);
  return { pool, repo, app, ...f };
}
test("weekly snapshots freeze facts and selections, concurrent recovery is immutable, follow-up uses actual later task events", async () => {
  const f = await setup(),
    { repo: r, pool, app } = f;
  let now = new Date(),
    allowed = true;
  const authorize = async () => {
      if (!allowed)
        throw Object.assign(Error("membership removed"), { statusCode: 403 });
    },
    s = new WeeklyCardService(r, () => now, authorize),
    tasks = new LightTickTaskService(r, () => now),
    focus = new TodayFocusService(
      r,
      new LightTickTodayService(r, () => now),
      () => now,
    ),
    rhythm = new DailyRhythmService(r, () => now);
  try {
    await tasks.command(o, f.tasks[0].id, 1, {
      action: "complete",
      actualMinutes: 5,
      notes: "完成三个要点",
    });
    now = new Date(+now + 1);
    const t = f.tasks[1];
    await focus.select(o, {
      request_key: "weekly-focus-select",
      base_version: 0,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: 1,
      success_criterion: "完整表达",
      first_step: "打开草稿",
    });
    await rhythm.command(o, {
      request_key: "weekly-minimum-mode",
      base_version: 1,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: 1,
      action: "mode",
      mode: "minimum",
      minimum_step: "只写标题",
    });
    await rhythm.command(o, {
      request_key: "weekly-minimum-attempt",
      base_version: 2,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: 1,
      action: "attempt",
      confirmed: true,
    });
    now = new Date(+now + 1);
    assert.equal((await s.read(o, "0001-01-01")).facts.length, 0);
    const v = await s.read(o);
    assert.equal(
      v.facts.find((f) => f.kind === "completed")?.task_variant,
      "standard",
    );
    assert.deepEqual(v.stats, {
      completed_count: 1,
      minimum_count: 1,
      action_days: 1,
    });
    const target = v.targets.find((x) => x.task_id === t.id)!;
    const body = {
      base_revision: 0,
      snapshot_hash: v.snapshot_hash,
      selected_fact_ids: v.facts.map((x) => x.id),
      review_text: "这周看见了行动证据",
      adjustment_text: "下一次先写标题再表达",
      adjustment_target: ref(target),
    };
    const [first, repeat] = await Promise.all([
      s.confirm(o, v.week_start, "weekly-original-key", body),
      s.confirm(o, v.week_start, "weekly-original-key", body),
    ]);
    assert.deepEqual(first, repeat);
    assert.equal((await r.listTasks(o)).length, 2);
    assert.equal(
      (await s.read(o)).follow_up?.completed_after_confirmation,
      false,
    );
    assert.equal(
      (await s.read(o)).follow_up?.minimum_attempts_after_confirmation,
      0,
    );
    now = new Date(+now + 1);
    await rhythm.command(o, {
      request_key: "weekly-follow-minimum",
      base_version: 3,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: 2,
      action: "attempt",
      confirmed: true,
    });
    assert.equal(
      (await s.read(o)).follow_up?.minimum_attempts_after_confirmation,
      1,
    );
    now = new Date(+now + 1);
    await tasks.command(o, t.id, 3, { action: "complete", actualMinutes: 2 });
    const changed = await s.read(o);
    assert.equal(changed.changed, true);
    assert.equal(changed.follow_up?.completed_after_confirmation, true);
    assert.equal(changed.follow_up?.completion_variant, "standard");
    assert.deepEqual(changed.card!.stats, {
      completed_count: 1,
      minimum_count: 1,
      action_days: 1,
    });
    await assert.rejects(
      s.confirm(o, v.week_start, "stale-snapshot-key", {
        ...body,
        base_revision: 1,
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      s.confirm(o, v.week_start, "invalid-fact-key", {
        ...body,
        base_revision: 1,
        snapshot_hash: changed.snapshot_hash,
        selected_fact_ids: ["other-owner-event"],
        adjustment_target: null,
      }),
      { statusCode: 422 },
    );
    await assert.rejects(
      s.confirm(o, v.week_start, "finished-target-key", {
        ...body,
        base_revision: 1,
        snapshot_hash: changed.snapshot_hash,
      }),
      { statusCode: 409 },
    );
    const update = {
      ...body,
      base_revision: 1,
      snapshot_hash: changed.snapshot_hash,
      selected_fact_ids: [v.facts[0].id],
      adjustment_target: null,
    };
    const save = r.saveOperation.bind(r);
    r.saveOperation = async () => {
      throw Error("receipt failed");
    };
    await assert.rejects(
      s.confirm(o, v.week_start, "weekly-second-key", update),
      /receipt failed/,
    );
    assert.equal((await s.read(o)).card!.revision, 1);
    r.saveOperation = save;
    const second = await s.confirm(
      o,
      v.week_start,
      "weekly-second-key",
      update,
    );
    assert.equal(second.revision, 2);
    assert.equal(second.history.length, 1);
    assert.deepEqual(second.history[0].facts, first.facts);
    assert.equal(second.history[0].adjustment_target!.task_id, t.id);
    assert.deepEqual(
      await new WeeklyCardService(
        new PostgresLightTickRepository(pool),
        () => now,
      ).confirm(o, v.week_start, "weekly-original-key", body),
      first,
    );
    await r.saveProfile({
      ...o,
      version: 1,
      timezone: "America/Los_Angeles",
      locale: "zh-CN",
      pace: "balanced",
      onboardingState: "not_started",
      notificationPreferences: {},
      onboardingDraft: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    assert.equal((await s.read(o, v.week_start)).timezone, "UTC");
    assert.equal(
      (await s.read(o, v.week_start)).current_timezone,
      "America/Los_Angeles",
    );
    now = new Date(+now + 8 * 86400000);
    assert.deepEqual(
      await s.confirm(o, v.week_start, "weekly-original-key", body),
      first,
    );
    allowed = false;
    await assert.rejects(
      s.confirm(o, v.week_start, "weekly-original-key", body),
      { statusCode: 403 },
    );
    allowed = true;
    assert.equal(
      (await s.read({ appId: "lighttick", userId: "user_bob" }, v.week_start))
        .card,
      null,
    );
    await r.deleteOwnerData(o);
    assert.equal((await s.read(o, v.week_start)).card, null);
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
test("canonical HTTP weekly card links today/future native tasks with owner/goal/plan versions and never auto creates an action", async () => {
  const f = await setup(),
    { repo: r, pool, app } = f;
  try {
    await app.services.lighttickRuntime.tasks.command(o, f.tasks[0].id, 1, {
      action: "complete",
      actualMinutes: 1,
    });
    const day = f.today.business_date,
      tomorrow = new Date(Date.parse(day) + 86400000)
        .toISOString()
        .slice(0, 10),
      goal = await f.ok("POST", "goals", {
        title: "后续方向",
        description: "",
        source_type: "user_input",
      }),
      plan = await f.ok("POST", "manual-plans", {
        goal_id: goal.id,
        title: "后续计划",
        completion_criteria: "可核对的小结果",
        period_start: day,
        period_end: tomorrow,
        tasks: [
          {
            id: randomUUID(),
            title: "明天先核对一条证据",
            scheduled_for: tomorrow,
            estimated_minutes: 5,
            completion_criteria: "核对一条事实",
            guidance: "打开记录",
          },
        ],
      });
    await f.ok("POST", `manual-plans/${plan.id}/confirm`, {
      base_version: plan.version,
      goal_base_version: plan.goal_version,
    });
    const request = (
      method: string,
      path: string,
      body?: unknown,
      key = "weekly-http-original",
    ) =>
      app.app.handle({
        method,
        path: "/api/v1/lighttick/" + path,
        body,
        headers: {
          "x-app-id": "lighttick",
          "x-lighttick-task-schema": "2",
          authorization:
            "Bearer " +
            app.services.tokenService.issueAccessToken(o.userId, "lighttick"),
          "idempotency-key": key,
        },
      } as any);
    const view: any = await request("GET", "weekly-cards");
    assert.equal(view.statusCode, 200);
    assert.equal(view.headers["Cache-Control"], "no-store");
    const v = view.body.data,
      target = v.targets.find((t: any) => t.goal_id === goal.id);
    assert.equal(target.scheduled_date, tomorrow);
    const body = {
      base_revision: 0,
      snapshot_hash: v.snapshot_hash,
      selected_fact_ids: [v.facts[0].id],
      review_text: "本周行动可回看",
      adjustment_text: "明天先核对事实",
      adjustment_target: ref(target),
    };
    const result: any = await request(
      "PUT",
      "weekly-cards/" + v.week_start,
      body,
    );
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal((await r.listTasks(o)).length, 3);
    const { default: Ajv } = await import("ajv/dist/2020.js"),
      { default: addFormats } = await import("ajv-formats"),
      schemas =
        await import("../../src/generated/openapi/public-contracts.generated.ts");
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    for (const [schema, value] of [
      [schemas.LightTickWeeklyViewEnvelopeSchema, view.body],
      [schemas.LightTickWeeklyCardEnvelopeSchema, result.body],
    ] as const) {
      const check = ajv.compile(schema);
      assert.ok(
        check(JSON.parse(JSON.stringify(value))),
        JSON.stringify(check.errors),
      );
    }

    const invalid = await request(
      "PUT",
      "weekly-cards/" + v.week_start,
      {
        ...body,
        base_revision: 1,
        adjustment_target: { ...body.adjustment_target, task_version: 999 },
      },
      "stale-target-reference",
    );
    assert.equal(invalid.statusCode, 409);
    const g = await r.getGoal(o, goal.id);
    await app.services.lighttickRuntime.goals.transition(
      o,
      goal.id,
      g!.version,
      "pause",
      { reason: "临时暂停" },
    );
    assert.equal(
      (await new WeeklyCardService(r).read(o)).targets.some(
        (t) => t.goal_id === goal.id,
      ),
      false,
    );
    assert.equal(
      (await new WeeklyCardService(r).read(o)).follow_up?.status,
      "unavailable",
    );
    assert.equal(
      (
        await request(
          "PUT",
          "weekly-cards/" + v.week_start,
          { ...body, base_revision: 1 },
          "paused-target-key",
        )
      ).statusCode,
      409,
    );
    const config = JSON.parse(
      (await app.services.appConfigService.getValue(
        "lighttick",
        "admin.delivery_config",
      ))!,
    );
    config.settings.runtimeScope = "core";
    await app.services.appConfigService.setValue(
      "lighttick",
      "admin.delivery_config",
      JSON.stringify(config),
    );
    assert.deepEqual(
      (await request("PUT", "weekly-cards/" + v.week_start, body)).body.data,
      result.body.data,
    );
    assert.equal(
      (await request("GET", "weekly-cards/invalid")).statusCode,
      404,
    );
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
test("weekly cards participate in full backup/restore and enforce immutable history limits and competing revisions", async () => {
  const f = await setup(),
    { repo: r, pool, app } = f;
  try {
    await app.services.lighttickRuntime.tasks.command(o, f.tasks[0].id, 1, {
      action: "complete",
      actualMinutes: 1,
    });
    const s = new WeeklyCardService(r),
      v = await s.read(o),
      body = {
        base_revision: 0,
        snapshot_hash: v.snapshot_hash,
        selected_fact_ids: [v.facts[0].id],
        review_text: "最初确认",
        adjustment_text: "只改一件事",
        adjustment_target: null,
      };
    const first = await s.confirm(
      o,
      v.week_start,
      "backup-week-original",
      body,
    );
    const { AccountBackupService } =
      await import("../../src/modules/lighttick/backup/account-backup.service.ts");
    const backup = new AccountBackupService(r, ["weekly-backup-test-key"]);
    const exported = await backup.export(
        o,
        "weekly-backup-export",
        async () => {},
      ),
      archive = await backup.download(o, exported.id);
    assert.equal(archive.tables.weekly_cards.length, 1);
    const race = await Promise.allSettled([
      s.confirm(o, v.week_start, "competing-card-a", {
        ...body,
        base_revision: 1,
        review_text: "版本A",
      }),
      s.confirm(o, v.week_start, "competing-card-b", {
        ...body,
        base_revision: 1,
        review_text: "版本B",
      }),
    ]);
    assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
    const preview = await backup.preview(
      o,
      "weekly-backup-preview",
      archive,
      async () => {},
      async () => {},
    );
    await backup.restore(
      o,
      "weekly-backup-restore",
      { preview_id: preview.id, mode: "replace", confirmed: true },
      async () => {},
      async () => {},
    );
    let restored = await s.read(o, v.week_start);
    assert.equal(restored.card!.review_text, "最初确认");
    assert.deepEqual(restored.card!.selected_fact_ids, first.selected_fact_ids);
    assert.ok(restored.card!.revision > first.revision);
    while (restored.card!.history.length < 19) {
      await s.confirm(
        o,
        v.week_start,
        "bounded-card-" + restored.card!.revision,
        {
          ...body,
          base_revision: restored.card!.revision,
          snapshot_hash: restored.snapshot_hash,
          review_text: "修订" + restored.card!.revision,
        },
      );
      restored = await s.read(o, v.week_start);
    }
    assert.equal(restored.card!.history.length, 19);
    await assert.rejects(
      s.confirm(o, v.week_start, "over-card-limit", {
        ...body,
        base_revision: restored.card!.revision,
        snapshot_hash: restored.snapshot_hash,
      }),
      { statusCode: 409 },
    );
    assert.deepEqual(
      await s.confirm(o, v.week_start, "backup-week-original", body),
      first,
    );
    assert.equal((await r.listTasks(o)).length, 2);
    await r.deleteOwnerData(o);
    assert.equal(await r.weeklyCards.get(o, v.week_start), undefined);
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
