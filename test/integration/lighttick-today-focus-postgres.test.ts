import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { seedTodayFocus } from "../support/today-focus-fixture.ts";
import { TodayFocusService } from "../../src/modules/lighttick/today-focus/today-focus.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_today_focus_")
)
  throw Error("Dedicated local today-focus DB required");
test("PostgreSQL today focus: concurrency, replay, rollback, task completion, reconnect, next-day isolation and deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    id: "daily-pg",
    appId: "lighttick",
    userId: "user_alice",
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: repo,
  });
  await repo.deleteOwnerData({ appId: "lighttick", userId: "user_alice" });
  try {
    const f = await seedTodayFocus(app),
      service = new TodayFocusService(
        repo,
        app.services.lighttickRuntime!.today,
      ),
      t = f.tasks[0];
    const body = {
      request_key: "daily-pg-select",
      base_version: 0,
      business_date: f.today.business_date,
      timezone: f.today.timezone,
      task_id: t.id,
      task_version: t.version,
      success_criterion: "PG criterion",
      first_step: "PG step",
    };
    const both = await Promise.all([
      service.select(f.owner, body),
      service.select(f.owner, { ...body }),
    ]);
    assert.deepEqual(both[0], both[1]);
    assert.equal((await service.current(f.owner)).revision, 1);
    const next = {
      ...body,
      request_key: "daily-pg-switch",
      base_version: 1,
      task_id: f.tasks[1].id,
      task_version: f.tasks[1].version,
    };
    await assert.rejects(
      repo.transaction(f.owner, async () => {
        await service.select(f.owner, next);
        throw Error("rollback");
      }),
    );
    assert.equal((await service.current(f.owner)).task_id, t.id);
    await assert.rejects(service.byRequest(f.owner, next.request_key));
    const races = await Promise.allSettled([
      service.select(f.owner, next),
      service.select(f.owner, {
        ...next,
        request_key: "daily-pg-competing",
        task_id: t.id,
      }),
    ]);
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await service.current(f.owner)).revision, 2);
    const current = await service.current(f.owner),
      task = (await repo.getTask(f.owner, current.task_id!))!;
    await f.ok("POST", "tasks/" + task.id + "/complete", {
      base_version: task.version,
    });
    assert.equal((await service.current(f.owner)).status, "completed");
    const reopenedRepo = new PostgresLightTickRepository(pool),
      reopened = new TodayFocusService(
        reopenedRepo,
        new LightTickTodayService(reopenedRepo),
      );
    assert.equal((await reopened.current(f.owner)).status, "completed");
    assert.deepEqual(
      await reopened.byRequest(f.owner, body.request_key),
      both[0],
    );
    const tomorrow = new Date(Date.now() + 86400000);
    const nextDay = new TodayFocusService(
      repo,
      new LightTickTodayService(repo, () => tomorrow),
    );
    assert.equal((await nextDay.current(f.owner)).revision, 0);
    assert.equal(
      (await service.current({ ...f.owner, userId: "other" })).revision,
      0,
    );
    await assert.rejects(
      service.byRequest({ ...f.owner, userId: "other" }, body.request_key),
    );
    await repo.deleteOwnerData(f.owner);
    assert.equal(
      await repo.todayFocus.get(f.owner, f.today.business_date),
      undefined,
    );
  } finally {
    await repo.deleteOwnerData({ appId: "lighttick", userId: "user_alice" });
    await pool.end();
  }
});
