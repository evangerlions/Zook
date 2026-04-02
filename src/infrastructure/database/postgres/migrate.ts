import { createHash } from "node:crypto";
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
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    ALTER TABLE zook_schema_migrations
    ADD COLUMN IF NOT EXISTS checksum TEXT
  `);
}

function computeChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function applyMigration(
  client: Client,
  fileName: string,
  sql: string,
  checksum: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `
        INSERT INTO zook_schema_migrations (name, checksum, applied_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (name)
        DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = EXCLUDED.applied_at
      `,
      [fileName, checksum],
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

    for (const fileName of migrationFiles) {
      const sql = await readFile(join(migrationsDir, fileName), "utf8");
      const checksum = computeChecksum(sql);
      console.log(`[db:migrate] applying idempotent migration: ${fileName}`);
      await applyMigration(client, fileName, sql, checksum);
    }

    console.log("[db:migrate] all migrations are up to date");
  } finally {
    await client.end().catch(() => undefined);
  }
}

await main();
