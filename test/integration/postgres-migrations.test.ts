import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";

const connectionString = process.env.ZOOK_MIGRATIONS_TEST_DATABASE_URL?.trim();
if (!connectionString) throw new Error("ZOOK_MIGRATIONS_TEST_DATABASE_URL must point to a fresh disposable database.");

test("initializes once and applies pending migrations atomically on a legacy ledger", async () => {
  const client = new Client({ connectionString });
  const logs: string[] = [];
  const migrate = () => runPostgresMigrations({ connectionString, log: (message) => logs.push(message) });
  const ledger = async () => (await client.query(
    "SELECT name, checksum, applied_at::text FROM zook_schema_migrations ORDER BY name",
  )).rows;
  const latest = "119_lighttick_local_generation.sql";

  await client.connect();
  try {
    const { rows: [initial] } = await client.query("SELECT to_regclass('zook_schema_migrations') AS ledger");
    assert.equal(initial.ledger, null, "the migration test requires an empty database");
    const files = await readdir(new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url));
    await migrate();
    const initialized = await ledger();
    assert.deepEqual(initialized.map((row) => row.name).sort(), files.filter((name) => name.endsWith(".sql")).sort());
    assert.ok(initialized.every((row) => /^[a-f0-9]{64}$/.test(row.checksum)));

    logs.length = 0;
    await migrate();
    assert.equal(logs.filter((message) => message.includes("applying")).length, 0);
    assert.deepEqual(await ledger(), initialized);

    await client.query("UPDATE zook_schema_migrations SET checksum = NULL WHERE name = '001_init.sql'");
    await client.query("DELETE FROM zook_schema_migrations WHERE name = $1", [latest]);
    await client.query("DROP TABLE zook_lighttick_local_generations");
    await client.query("CREATE TABLE zook_lighttick_local_generations (id TEXT PRIMARY KEY)");
    await client.query("ALTER TABLE zook_lighttick_learning_authorities DROP COLUMN consent_revision");
    const legacy = await ledger();
    await assert.rejects(migrate(), { code: "42703" });
    assert.deepEqual(await ledger(), legacy);
    const { rows: [failed] } = await client.query(`SELECT EXISTS (
      SELECT FROM information_schema.columns WHERE table_name = 'zook_lighttick_learning_authorities'
        AND column_name = 'consent_revision' AND table_schema = current_schema()
    ) AS column_exists`);
    assert.equal(failed.column_exists, false, "failed migration must roll back its schema changes");

    await client.query("DROP TABLE zook_lighttick_local_generations");
    logs.length = 0;
    await Promise.all([migrate(), migrate()]);
    const upgraded = await ledger();
    assert.deepEqual(logs.filter((message) => message.includes("applying")), [`[db:migrate] applying migration: ${latest}`]);
    assert.deepEqual(upgraded.filter((row) => row.name !== latest), legacy);
    assert.equal(upgraded.find((row) => row.name === latest)?.checksum, initialized.find((row) => row.name === latest)?.checksum);
    await client.query("SELECT status FROM zook_lighttick_local_generations LIMIT 0");

    await client.query("UPDATE zook_schema_migrations SET checksum = 'different' WHERE name = $1", [latest]);
    await client.query("DELETE FROM zook_schema_migrations WHERE name = '000_reset_legacy_runtime_tables.sql'");
    const drifted = await ledger();
    logs.length = 0;
    await assert.rejects(migrate(), /checksum mismatch.*119_lighttick_local_generation\.sql/i);
    assert.equal(logs.filter((message) => message.includes("applying")).length, 0);
    assert.deepEqual(await ledger(), drifted);
  } finally {
    await client.end();
  }
});
