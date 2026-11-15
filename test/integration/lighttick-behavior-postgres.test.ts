import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { BehaviorService } from "../../src/modules/lighttick/behavior/behavior.service.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_behavior_")
)
  throw Error("Dedicated behavior DB required");
test("PG behavior aggregates/paging/CAS/owner cleanup and separate frozen report topics", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "behavior-" + randomUUID() },
    clock = () => new Date("2026-11-15T08:00:00Z"),
    s = new BehaviorService(repo, clock);
  try {
    for (let i = 0; i < 23; i++)
      await s.save(
        o,
        "application-pg-" + i,
        {
          base_version: 0,
          date: "2026-11-15",
          module_id: "general",
          concept: i % 2 ? "核实%_" : "检验",
          scenario: "PRIVATE_SCENARIO",
          effectiveness: i % 2 ? 4 : 0,
        },
        "pg-behavior-" + i,
      );
    const page = await s.list(o, { page: "999" });
    assert.equal(page.total, 23);
    assert.equal(page.page, 2);
    assert.equal(page.items.length, 3);
    assert.equal(page.stats.rated_count, 11);
    assert.equal(page.stats.effectiveness_avg, 4);
    assert.equal((await s.list(o, { q: "%_" })).total, 11);
    assert.equal((await s.concepts(o, {})).total, 2);
    assert.equal((await s.concepts(o, { q: "%_" })).items[0].count, 11);
    const r = await s.get(o, "application-pg-0");
    const results = await Promise.allSettled(
      ["a", "b"].map((key) =>
        s.save(
          o,
          r.id,
          {
            base_version: 1,
            date: r.date,
            module_id: r.module_id,
            concept: r.concept,
            scenario: key,
            effectiveness: 3,
          },
          "pg-compare-" + key,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const reports = new AccountReportService(
      repo,
      undefined,
      undefined,
      clock,
      undefined,
      "behavior",
    );
    const saved = await reports.create(o, {
      request_key: "pg-behavior-report",
      mode: "facts",
      period_days: 7,
    });
    assert.equal(saved.facts!.behavior!.applications.total, 23);
    assert.ok(!JSON.stringify(saved.facts).includes("PRIVATE_SCENARIO"));
    assert.equal((await reports.list(o, {})).total, 1);
    assert.equal((await new AccountReportService(repo).list(o, {})).total, 0);
    await s.archive(
      o,
      "application-pg-1",
      { base_version: 1, archived: true },
      "pg-archive-app",
    );
    assert.equal(
      (await reports.get(o, saved.id)).facts!.behavior!.applications.total,
      23,
    );
    const other = { ...o, userId: "other" };
    assert.equal((await s.list(other, {})).total, 0);
    await repo.deleteOwnerData(o);
    assert.equal((await s.list(o, {})).total, 0);
    assert.equal((await reports.list(o, {})).total, 0);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
