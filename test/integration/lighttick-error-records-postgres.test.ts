import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { ErrorRecordsService } from "../../src/modules/lighttick/error-records/error-records.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_errors_")
)
  throw Error("Dedicated synthetic error-record DB required");
test("PostgreSQL errors: SQL filters/paging/stats, CAS contention, cyclic links, immutable receipts, reconnect and owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "errors-" + randomUUID() },
    clock = () => new Date("2026-11-15T08:00:00Z"),
    s = new ErrorRecordsService(repo, clock),
    body = {
      base_version: 0,
      date: "2026-11-15",
      module_id: "general",
      category_id: "builtin-omission",
      description: "literal %_ 中文",
      severity: 3,
      context: "讨论",
      improvement_action: "写下核对表",
      is_repeat: false,
      related_error_id: null,
    };
  try {
    const first = await s.save(o, "error-first", body, "pg-first-error");
    for (let i = 0; i < 22; i++)
      await s.save(
        o,
        "error-item-" + i,
        {
          ...body,
          description: "重复记录 " + i,
          is_repeat: i % 2 === 0,
          related_error_id: first.id,
        },
        "pg-errors-item-" + i,
      );
    const page = await s.list(o, { page_size: "10", page: "99" });
    assert.equal(page.total, 23);
    assert.equal(page.page, 3);
    assert.equal(page.items.length, 3);
    assert.equal(page.stats.repeated, 11);
    assert.equal(page.stats.categories[0].count, 23);
    assert.equal(page.stats.daily[0].date, "2026-11-15");
    assert.equal((await s.list(o, { q: "%_" })).total, 1);
    assert.equal((await s.list(o, { repeat: "true" })).total, 11);
    const incoming = await s.detail(o, first.id);
    assert.equal(incoming.linked_from.total, 22);
    assert.equal(incoming.linked_from.items.length, 10);
    assert.equal(
      (await s.detail(o, first.id, incoming.linked_from.next_cursor!))
        .linked_from.items.length,
      10,
    );
    await assert.rejects(
      s.save(
        o,
        first.id,
        { ...body, base_version: 1, related_error_id: "error-item-0" },
        "pg-cycle-error",
      ),
    );
    const races = await Promise.allSettled([
      s.save(
        o,
        first.id,
        { ...body, base_version: 1, description: "A" },
        "pg-error-race-a",
      ),
      s.save(
        o,
        first.id,
        { ...body, base_version: 1, description: "B" },
        "pg-error-race-b",
      ),
    ]);
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(
      repo.transaction(o, async () => {
        await s.save(o, "error-rollback", body, "pg-error-rollback");
        throw Error("rollback");
      }),
    );
    await assert.rejects(s.receipt(o, "pg-error-rollback"));
    const category = await s.createCategory(
      o,
      { name: "回看不足", description: "" },
      "pg-create-category",
    );
    await s.save(
      o,
      "error-category",
      { ...body, category_id: category.id, date: "2020-01-01" },
      "pg-record-category",
    );
    assert.equal((await s.lookup(o, { q: "%_" })).total, 1);
    await assert.rejects(
      s.deleteCategory(
        o,
        category.id,
        { base_version: 1 },
        "pg-delete-used-category",
      ),
    );
    const reopened = new ErrorRecordsService(
      new PostgresLightTickRepository(pool),
      clock,
    );
    assert.equal((await reopened.receipt(o, "pg-first-error")).version, 1);
    assert.equal((await reopened.detail(o, first.id)).record.version, 2);
    await assert.rejects(reopened.detail({ ...o, userId: "other" }, first.id));
    assert.equal(
      (await reopened.lookup({ ...o, userId: "other" }, {})).total,
      0,
    );
    await s.archive(
      o,
      first.id,
      { base_version: 2, archived: true },
      "pg-archive-error",
    );
    assert.equal((await s.detail(o, "error-item-0")).related!.archived, true);
    await s.archive(
      o,
      first.id,
      { base_version: 3, archived: false },
      "pg-restore-error",
    );
    await repo.deleteOwnerData(o);
    assert.equal((await repo.errorRecords.categories(o)).length, 0);
    assert.equal(await repo.errorRecords.get(o, first.id), undefined);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
