import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_focus_")
)
  throw Error("Disposable focus database required.");
test("PostgreSQL focus: one active slot, midnight timezone, pause recovery, CAS, receipts, rollback and rest exclusion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "focus-" + randomUUID() },
    bob = { appId: "lighttick" as const, userId: "focus-bob-" + randomUUID() };
  let now = Date.parse("2026-11-14T15:59:30Z");
  const clock = () => new Date(now),
    s = new FocusService(repo, clock);
  try {
    await repo.saveProfile({
      ...owner,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      pace: "balanced",
      onboardingState: "none",
      notificationPreferences: {},
      onboardingDraft: {},
      version: 1,
      createdAt: clock().toISOString(),
      updatedAt: clock().toISOString(),
    });
    const start = {
      request_key: "focus-pg-start-001",
      kind: "focus",
      title: "跨日专注",
      planned_seconds: 120,
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => s.start(owner, start)),
    );
    assert.equal(new Set(results.map((r) => r.session!.id)).size, 1);
    const id = results[0].session!.id;
    assert.equal(results[0].session!.business_date, "2026-11-14");
    await assert.rejects(
      () =>
        s.start(owner, {
          ...start,
          request_key: "focus-pg-conflict",
          kind: "break",
        }),
      { statusCode: 409 },
    );
    now += 20000;
    await s.command(owner, id, {
      request_key: "focus-pg-pause",
      base_version: 1,
      action: "pause",
    });
    now += 120000;
    const reopened = new FocusService(
      new PostgresLightTickRepository(pool),
      clock,
    );
    assert.equal((await reopened.current(owner)).session!.elapsed_seconds, 20);
    await assert.rejects(
      () =>
        s.command(owner, id, {
          request_key: "focus-pg-stale",
          base_version: 1,
          action: "resume",
        }),
      { statusCode: 409 },
    );
    await s.command(owner, id, {
      request_key: "focus-pg-resume",
      base_version: 2,
      action: "resume",
    });
    now += 90000;
    await assert.rejects(
      () =>
        s.command(owner, id, {
          request_key: "focus-pg-overclaim",
          base_version: 3,
          action: "finish",
          actual_seconds: 111,
        }),
      { statusCode: 400 },
    );
    await assert.rejects(
      repo.transaction(owner, async () => {
        await s.command(owner, id, {
          request_key: "focus-pg-rollback",
          base_version: 3,
          action: "finish",
          actual_seconds: 100,
        });
        throw Error("rollback");
      }),
    );
    assert.equal((await s.current(owner)).session!.status, "running");
    await assert.rejects(() => s.byRequest(owner, "focus-pg-rollback"), {
      statusCode: 404,
    });
    const finish = {
      request_key: "focus-pg-finish",
      base_version: 3,
      action: "finish",
      actual_seconds: 100,
      notes: "真实投入 100 秒，保留 %_ 中文",
    };
    await s.command(owner, id, finish);
    assert.deepEqual(
      await s.command(owner, id, finish),
      await s.byRequest(owner, "focus-pg-finish"),
    );
    assert.equal(
      (await repo.focus.summary(owner, "2026-11-14", "2026-11-14")).seconds,
      100,
    );
    assert.equal(
      (await repo.focus.summary(owner, "2026-11-15", "2026-11-15")).seconds,
      0,
    );
    const rest = await s.start(owner, {
      request_key: "focus-pg-break-start",
      kind: "break",
      title: "Rest",
      planned_seconds: 60,
    });
    now += 60000;
    await s.command(owner, rest.session!.id, {
      request_key: "focus-pg-break-finish",
      base_version: 1,
      action: "finish",
      actual_seconds: 60,
    });
    assert.equal(
      (await repo.focus.summary(owner, "2026-11-14", "2026-11-15")).seconds,
      100,
    );
    assert.equal((await s.history(owner, { kind: "break" })).total, 1);
    assert.equal((await s.history(bob, {})).total, 0);
    await assert.rejects(() => s.get(bob, id), { statusCode: 404 });
    await assert.rejects(() => s.byRequest(bob, "focus-pg-finish"), {
      statusCode: 404,
    });
    await s.preferences(owner, {
      request_key: "focus-pg-prefs",
      base_version: 0,
      focus_minutes: 15,
      break_minutes: 3,
      reminders_enabled: false,
    });
    assert.equal((await reopened.current(owner)).preferences.focus_minutes, 15);
  } finally {
    await repo.deleteOwnerData(owner);
    assert.equal((await repo.focus.history(owner, 0, 50)).total, 0);
    await pool.end();
  }
});
