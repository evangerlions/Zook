import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedTodayFocus } from "../support/today-focus-fixture.ts";
import { DailyRhythmService } from "../../src/modules/lighttick/today-focus/daily-rhythm.service.ts";
import { TodayFocusService } from "../../src/modules/lighttick/today-focus/today-focus.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_rhythm_")
)
  throw Error("Dedicated local rhythm DB required");
test("minimum action preserves complete task, canonical sync/event versions and exactly-once facts; rest is intent and history survives next day", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick", userId: "user_alice" },
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    ...o,
    id: "rhythm-alice",
    status: "ACTIVE",
    accountRegion: "CN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: r,
  });
  try {
    await r.deleteOwnerData(o);
    const f = await seedTodayFocus(app),
      t = f.tasks[0];
    let now = new Date();
    const s = new DailyRhythmService(r, () => now),
      focus = new TodayFocusService(
        r,
        new LightTickTodayService(r, () => now),
        () => now,
      );
    const selected = await focus.select(o, {
      request_key: "rhythm-select-key",
      base_version: 0,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: t.version,
      success_criterion: "三个要点",
      first_step: "标题",
    });
    const mode = {
      request_key: "minimum-mode-original",
      base_version: 1,
      business_date: selected.business_date,
      timezone: selected.timezone,
      task_id: t.id,
      task_version: t.version,
      action: "mode",
      mode: "minimum",
      minimum_step: "写下一句标题",
    };
    await s.command(o, mode);
    const body = {
      ...mode,
      action: "attempt",
      request_key: "minimum-attempt-original",
      base_version: 2,
      confirmed: true,
    } as any;
    delete body.mode;
    delete body.minimum_step;
    const prior = (await r.getTask(o, t.id))!;
    const attempts = await Promise.all([
      s.command(o, body),
      s.command(o, body),
    ]);
    assert.deepEqual(attempts[0], attempts[1]);
    const after = (await r.getTask(o, t.id))!;
    assert.equal(after.status, "pending");
    assert.equal(after.version, prior.version + 1);
    assert.equal(after.completedAt, prior.completedAt);
    assert.equal(after.commitmentSatisfied, prior.commitmentSatisfied);
    let snapshot = await focus.current(o);
    assert.equal(snapshot.attempts?.length, 1);
    assert.equal(snapshot.mode, "minimum");
    assert.equal((await app.services.lighttickRuntime.progressive.commitmentState(o)).valid_action_count,0);
    assert.equal(
      (await r.listExecutionEvents(o)).filter(
        (e) => e.eventType === "task_minimum_step_recorded",
      ).length,
      1,
    );
    assert.equal(
      (await r.listExecutionEvents(o)).filter(
        (e) =>
          e.eventType === "task_complete" || e.eventType === "task_completed",
      ).length,
      0,
    );
    await assert.rejects(
      s.command(o, { ...body, request_key: "stale-attempt-original" }),
      { statusCode: 409 },
    );
    const rest = {
      ...mode,
      request_key: "rest-original-key",
      base_version: snapshot.revision,
      task_version: after.version,
      mode: "rest",
      minimum_step: "",
    };
    await s.command(o, rest);
    assert.equal((await r.getTask(o, t.id))?.status, "pending");
    assert.equal((await focus.current(o)).mode, "rest");
    const beforeMidnight = await focus.current(o);
    let clockReads = 0;
    const nearMidnight = new DailyRhythmService(
      r,
      () =>
        new Date(
          Date.parse(beforeMidnight.business_date + "T23:59:59.999Z") +
            (clockReads++ === 0 ? 0 : 1),
        ),
    );
    const frozen: any = await nearMidnight.command(o, {
      ...rest,
      request_key: "midnight-rest-key",
      base_version: beforeMidnight.revision,
    });
    assert.equal(clockReads, 1);
    assert.equal(frozen.business_date, beforeMidnight.business_date);
    now = new Date(+now + 86400000);
    assert.equal((await focus.current(o)).mode, "standard");
    assert.equal(
      (await s.history(o, selected.business_date))?.attempts.length,
      1,
    );
    assert.deepEqual(await s.command(o, body), attempts[0]);
    assert.equal(
      await s.history(
        { appId: "lighttick", userId: "user_bob" },
        selected.business_date,
      ),
      null,
    );
    await assert.rejects(
      s.command(o, { ...mode, request_key: "yesterday-mode-key" }),
      { statusCode: 409 },
    );
    await r.deleteOwnerData(o);
    assert.equal(await s.history(o, selected.business_date), null);
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
test("real HTTP mode commands reject active timers/running tasks, version and authority changes; failed receipt rolls back both fact and focus", async () => {
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick", userId: "user_alice" },
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    ...o,
    id: "rhythm-api-alice",
    status: "ACTIVE",
    accountRegion: "CN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: r,
  });
  try {
    await r.deleteOwnerData(o);
    const f = await seedTodayFocus(app),
      t = f.tasks[0],
      s = new DailyRhythmService(r),
      focus = new TodayFocusService(r, new LightTickTodayService(r));
    const b = {
      request_key: "http-select-original",
      base_version: 0,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: t.version,
      success_criterion: "完成小结果",
      first_step: "打开草稿",
    };
    await focus.select(o, b);
    const mode = {
      request_key: "http-mode-original",
      base_version: 1,
      business_date: b.business_date,
      timezone: b.timezone,
      task_id: t.id,
      task_version: t.version,
      action: "mode",
      mode: "minimum",
      minimum_step: "写标题",
    };
    const ok = await f.call("PUT", "today/focus/rhythm", mode);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(ok.headers["Cache-Control"], "no-store");
    const body = {
      request_key: "rollback-attempt-key",
      base_version: 2,
      business_date: b.business_date,
      timezone: b.timezone,
      task_id: t.id,
      task_version: t.version,
      action: "attempt",
      confirmed: true,
    };
    const save = r.saveOperation.bind(r);
    r.saveOperation = async () => {
      throw Error("receipt failure");
    };
    await assert.rejects(s.command(o, body), /receipt failure/);
    assert.equal((await focus.current(o)).revision, 2);
    assert.equal((await r.getTask(o, t.id))?.version, t.version);
    assert.equal(
      (await r.listExecutionEvents(o)).filter(
        (e) => e.eventType === "task_minimum_step_recorded",
      ).length,
      0,
    );
    r.saveOperation = save;
    const attempted: any = await s.command(o, body);
    const rest = {
      ...mode,
      request_key: "busy-rest-original",
      base_version: attempted.revision,
      task_version: attempted.task_version,
      mode: "rest",
      minimum_step: "",
    };
    await app.services.lighttickRuntime.tasks.command(
      o,
      t.id,
      attempted.task_version,
      { action: "start" },
    );
    const running = (await r.getTask(o, t.id))!;
    await assert.rejects(
      s.command(o, { ...rest, task_version: running.version }),
      { statusCode: 409 },
    );
    await app.services.lighttickRuntime.tasks.command(
      o,
      t.id,
      running.version,
      { action: "complete", actualMinutes: 1 },
    );
    const current = await focus.current(o);
    const restAfter = {
      ...rest,
      request_key: "completed-rest-key",
      task_version: current.task_version,
    };
    const { FocusService } =
      await import("../../src/modules/lighttick/focus/focus.service.ts");
    const timers = new FocusService(r);
    const timer = await timers.start(o, {
      request_key: "rhythm-active-timer",
      kind: "focus",
      title: "正在专注",
      planned_seconds: 60,
    });
    await assert.rejects(s.command(o, restAfter), { statusCode: 409 });
    await timers.command(o, timer.session!.id, {
      request_key: "rhythm-stop-timer",
      base_version: timer.session!.revision,
      action: "discard",
    });
    await s.command(o, restAfter);
    const response = await app.app.handle({
      method: "GET",
      path: "/api/v1/lighttick/today/focus/rhythm",
      query: { date: b.business_date },
      headers: {
        "x-app-id": "lighttick",
        "x-lighttick-task-schema": "2",
        authorization:
          "Bearer " +
          app.services.tokenService.issueAccessToken(o.userId, "lighttick"),
      },
    } as any);
    assert.equal(response.statusCode, 200);
    assert.equal((response.body.data as any).mode, "rest");
    const { default: Ajv } = await import("ajv/dist/2020.js"),
      { default: addFormats } = await import("ajv-formats"),
      schemas =
        await import("../../src/generated/openapi/public-contracts.generated.ts");
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    for (const [schema, value] of [
      [schemas.LightTickTodayFocusEnvelopeSchema, ok.body],
      [schemas.LightTickTodayFocusDayEnvelopeSchema, response.body],
    ] as const) {
      const check = ajv.compile(schema);
      assert.ok(
        check(JSON.parse(JSON.stringify(value))),
        JSON.stringify(check.errors),
      );
    }

    let authorized = false;
    const blocked = new DailyRhythmService(
      r,
      () => new Date(),
      async () => {
        if (!authorized)
          throw Object.assign(Error("removed membership"), { statusCode: 403 });
      },
    );
    await assert.rejects(blocked.command(o, body), { statusCode: 403 });
    authorized = true;
    assert.deepEqual(await blocked.command(o, body), attempted);
  } finally {
    await r.deleteOwnerData(o);
    await pool.end();
  }
});
