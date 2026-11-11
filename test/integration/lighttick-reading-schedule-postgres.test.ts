import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { ReadingPreferencesService } from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingScheduleService } from "../../src/modules/lighttick/reading/reading-schedule.service.ts";
import {
  seedReadingRecommendation,
  recommendationFeed,
  recommendationText,
} from "../support/reading-recommendation-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("PostgreSQL daily claims serialize, exact8 full texts adopt atomically, reconnect/receipts/export survive and cleanup removes runtime state", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "daily-pg-" + process.pid },
    clock = () => new Date("2026-11-12T02:00:00Z"),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      async () => {},
      clock,
    ),
    schedule = new ReadingScheduleService(work);
  try {
    await seedReadingRecommendation(work, owner, 8);
    const prefs = await work.store.preferences.get(owner);
    await new ReadingPreferencesService(work).save(
      owner,
      {
        base_revision: 1,
        value: { ...prefs!.value, enabled: true, hour: 10, minute: 0 },
      },
      "daily-pg-enable",
    );
    assert.ok(
      (
        await work.store.schedule.due(
          "2026-11-12",
          600,
          clock().toISOString(),
          20,
        )
      ).some((o) => o.userId === owner.userId),
    );
    const claims = await Promise.all([
      schedule.advance(owner, "2026-11-12"),
      schedule.advance(owner, "2026-11-12"),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    let day = (await schedule.read(owner)).day!;
    assert.equal(day.attempts, 1);
    await new ReadingWorkRunner(
      work,
      {
        complete: async () => {
          throw Error("No implicit paid model");
        },
      } as any,
      async (url) =>
        url.endsWith("/feed")
          ? {
              body: recommendationFeed(12),
              content_type: "application/rss+xml",
            }
          : { body: recommendationText, content_type: "text/plain" },
    ).execute(owner, day.work_id!);
    const original = repo.saveOperation.bind(repo);
    repo.saveOperation = async (row) => {
      if (row.action === "work:adopt")
        throw Error("Injected daily receipt failure");
      return original(row);
    };
    await assert.rejects(schedule.advance(owner, day.date), /Injected/);
    assert.equal((await repo.reading.recommendationHistory(owner)).length, 0);
    assert.equal((await schedule.read(owner)).day!.revision, day.revision);
    repo.saveOperation = original;
    const freshRepo = new PostgresLightTickRepository(pool),
      fresh = new ReadingWorkService(
        freshRepo,
        new InMemoryJobQueue(),
        async () => {},
        clock,
      ),
      restart = new ReadingScheduleService(fresh);
    await restart.advance(owner, day.date);
    day = (await restart.read(owner)).day!;
    assert.equal(day.phase, "complete");
    assert.equal(day.adopted.length, 8);
    assert.equal(day.attempts, 1);
    assert.equal((await fresh.store.preferences.get(owner))!.revision, 2);
    assert.equal(
      (await freshRepo.reading.recommendationHistory(owner)).length,
      8,
    );
    assert.ok(
      !(
        await fresh.store.schedule.due(day.date, 600, clock().toISOString(), 20)
      ).some((o) => o.userId === owner.userId),
    );
    assert.equal((await restart.read({ ...owner, userId: "other" })).day, null);
    const receipt = (
      await pool.query(
        "SELECT result_payload FROM zook_lighttick_operations WHERE user_id=$1 AND action='work:adopt' LIMIT1".replace(
          "LIMIT1",
          "LIMIT 1",
        ),
        [owner.userId],
      )
    ).rows[0].result_payload;
    assert.equal("output" in receipt.work, false);
    assert.equal(receipt.work.has_output, true);
    const off=await new ReadingPreferencesService(fresh).disable(owner,{base_revision:2},"daily-pg-disable-future");assert.equal(off.value.enabled,false);assert.equal(off.revision,3);assert.ok(!(await fresh.store.schedule.due("2026-11-13",600,"2026-11-13T02:00:00.000Z",20)).some(o=>o.userId===owner.userId));
    const { ReadingService } = await import(
      "../../src/modules/lighttick/reading/reading.service.ts"
    );
    const exported = await new ReadingService(freshRepo).export(owner);
    assert.equal(exported.schedule.length, 1);
    assert.equal(exported.schedule[0].adopted.length, 8);
  } finally {
    await repo.deleteOwnerData(owner);
    assert.equal(
      (await work.store.schedule.history(owner, "9999-12-31", 30)).length,
      0,
    );
    assert.equal((await work.store.assets.list(owner, "unused")).length, 0);
    await pool.end();
  }
});
