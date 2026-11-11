import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("restarting an unchanged API or worker skips applied SQL while owner writes hold child-table locks", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const owner = new Client({ connectionString: dsn });
  await owner.connect();
  try {
    const before = (
      await owner.query(
        "SELECT name,checksum,applied_at FROM zook_schema_migrations ORDER BY name",
      )
    ).rows;
    await owner.query("BEGIN");
    await owner.query(
      "LOCK TABLE zook_lighttick_task_steps IN ROW EXCLUSIVE MODE",
    );
    const bounded = new URL(dsn);
    bounded.searchParams.set("options", "-c lock_timeout=300ms");
    const logs: string[] = [];
    await runPostgresMigrations({
      connectionString: bounded.toString(),
      log: (s) => logs.push(s),
    });
    await owner.query("LOCK TABLE zook_lighttick_tasks IN ROW EXCLUSIVE MODE");
    await owner.query("ROLLBACK");
    const after = (
      await owner.query(
        "SELECT name,checksum,applied_at FROM zook_schema_migrations ORDER BY name",
      )
    ).rows;
    assert.deepEqual(
      after,
      before,
      "unchanged startup must not rewrite applied migration facts",
    );
    assert.ok(logs.some((s) => s.includes("skipping unchanged migration")));
    assert.equal(
      logs.some((s) => s.includes("applying idempotent migration")),
      false,
    );
  } finally {
    await owner.query("ROLLBACK").catch(() => {});
    await owner.end();
  }
});
