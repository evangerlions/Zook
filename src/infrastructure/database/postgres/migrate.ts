import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { resolveRuntimeMigrationDatabaseUrl } from "../../runtime/runtime-readiness.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

async function ensureMigrationTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS zook_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadAppliedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>(
    "SELECT name FROM zook_schema_migrations ORDER BY name ASC",
  );
  return new Set(result.rows.map((row) => row.name));
}

async function applyMigration(client: Client, fileName: string, sql: string): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO zook_schema_migrations (name, applied_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING",
      [fileName],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const databaseUrl = resolveRuntimeMigrationDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required to run database migrations.");
  }
  const source = process.env.DIRECT_URL?.trim() ? "DIRECT_URL" : "DATABASE_URL";
  console.log(`[db:migrate] using ${source}`);

  const migrationFiles = (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    await ensureMigrationTable(client);
    const appliedMigrations = await loadAppliedMigrations(client);

    for (const fileName of migrationFiles) {
      if (appliedMigrations.has(fileName)) {
        console.log(`[db:migrate] skip already applied migration: ${fileName}`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, fileName), "utf8");
      console.log(`[db:migrate] applying migration: ${fileName}`);
      await applyMigration(client, fileName, sql);
    }

    console.log("[db:migrate] all migrations are up to date");
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
