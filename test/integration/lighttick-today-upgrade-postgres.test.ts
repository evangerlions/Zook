import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")) throw Error("Use a disposable local LightTick database.");

test("the Today migration includes an old writer that commits while DDL is waiting, and is safe to replay", async () => {
  const migrations = new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url);
  const target = "118_lighttick_today_revision.sql";
  const legacy = new Client({ connectionString: dsn });
  const upgrade = new Client({ connectionString: dsn, application_name: "today-upgrade-test" });
  await Promise.all([legacy.connect(), upgrade.connect()]);
  try {
    await legacy.query("CREATE TABLE zook_schema_migrations (name TEXT PRIMARY KEY, checksum TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql") && name < target).sort()) {
      await legacy.query(await readFile(new URL(file, migrations), "utf8"));
      await legacy.query("INSERT INTO zook_schema_migrations (name) VALUES ($1)", [file]);
    }
    await legacy.query(
      "INSERT INTO zook_lighttick_goals (id, app_id, user_id, title, status, version) VALUES ('legacy-goal', 'lighttick', 'legacy-user', 'Goal', 'active', 73)",
    );
    await legacy.query("BEGIN");
    await legacy.query("UPDATE zook_lighttick_goals SET version=84 WHERE id='legacy-goal'");
    const sql = await readFile(new URL(target, migrations), "utf8");
    const migration = upgrade.query("BEGIN; " + sql + " COMMIT;");
    try {
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        const observation = await legacy.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE application_name='today-upgrade-test'",
        );
        waiting = observation.rows[0]?.wait_event_type === "Lock";
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(waiting, "Migration must serialize with the old writer.");
    } finally {
      await legacy.query("COMMIT");
      await migration;
    }
    const read = async () => (await legacy.query(
      "SELECT revision::text FROM zook_lighttick_today_revisions WHERE app_id='lighttick' AND user_id='legacy-user'",
    )).rows[0]?.revision;
    assert.equal(await read(), "84");

    await legacy.query("UPDATE zook_lighttick_goals SET title='Changed', version=85 WHERE id='legacy-goal'");
    assert.equal(await read(), "85");
    await runPostgresMigrations({ connectionString: dsn, log: () => {} });
    assert.equal(await read(), "85");

    await legacy.query("UPDATE zook_lighttick_goals SET title='Changed again', version=86 WHERE id='legacy-goal'");
    assert.equal(await read(), "86");
  } finally {
    await Promise.all([legacy.end(), upgrade.end()]);
  }
});
