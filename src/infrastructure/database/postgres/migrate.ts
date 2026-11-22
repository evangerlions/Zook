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
  const { rows: [columns] } = await client.query<{ has_checksum: boolean }>(`
    SELECT EXISTS (
      SELECT FROM pg_attribute WHERE attrelid = 'zook_schema_migrations'::regclass
        AND attname = 'checksum' AND NOT attisdropped
    ) AS has_checksum
  `);
  if (!columns.has_checksum) {
    await client.query("ALTER TABLE zook_schema_migrations ADD COLUMN checksum TEXT");
  }
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
      `,
      [fileName, checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function listMigrationFiles() {
  return (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

export async function runPostgresMigrations(options: {
  connectionString?: string;
  log?: (message: string) => void;
} = {}): Promise<void> {
  const databaseUrl = options.connectionString?.trim() || resolveRuntimeMigrationDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required to run database migrations.");
  }
  const log = options.log ?? ((message: string) => console.log(message));
  const source = options.connectionString?.trim()
    ? "provided connection string"
    : process.env.DIRECT_URL?.trim() ? "DIRECT_URL" : "DATABASE_URL";
  log(`[db:migrate] using ${source}`);

  const migrationFiles = await listMigrationFiles();

  const client = new Client({
    connectionString: databaseUrl,
  });

  try {
    await client.connect();
    // Read the ledger under the same session lock used for all pending migrations.
    await client.query("SELECT pg_advisory_lock(hashtext('zook'), hashtext('schema-migrations'))");
    await ensureMigrationTable(client);
    const { rows } = await client.query<{ name: string; checksum: string | null }>(
      "SELECT name, checksum FROM zook_schema_migrations",
    );
    const applied = new Map(rows.map(({ name, checksum }) => [name, checksum]));
    const pending: { fileName: string; sql: string; checksum: string }[] = [];

    for (const fileName of migrationFiles) {
      const recordedChecksum = applied.get(fileName);
      // Older ledgers recorded names only. A NULL checksum still represents an applied migration.
      if (recordedChecksum === null) continue;
      const sql = await readFile(join(migrationsDir, fileName), "utf8");
      const checksum = computeChecksum(sql);
      if (recordedChecksum === undefined) {
        pending.push({ fileName, sql, checksum });
      } else if (recordedChecksum !== checksum) {
        throw new Error(`Migration checksum mismatch for ${fileName}. Keep applied SQL unchanged and use a new migration.`);
      }
    }

    for (const { fileName, sql, checksum } of pending) {
      log(`[db:migrate] applying migration: ${fileName}`);
      await applyMigration(client, fileName, sql, checksum);
    }

    log(`[db:migrate] all migrations are up to date (applied=${pending.length}, skipped=${migrationFiles.length - pending.length})`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await runPostgresMigrations();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
