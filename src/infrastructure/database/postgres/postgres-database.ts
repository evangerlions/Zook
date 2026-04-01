import { Pool, type PoolClient } from "pg";
import type { DatabaseSeed } from "../../../shared/types.ts";
import { InMemoryDatabase, type DatabaseStateSnapshot } from "../prisma/in-memory-database.ts";

interface PostgresCollectionDefinition {
  key: keyof DatabaseStateSnapshot;
  tableName: string;
}

const POSTGRES_COLLECTIONS: PostgresCollectionDefinition[] = [
  { key: "apps", tableName: "zook_apps" },
  { key: "users", tableName: "zook_users" },
  { key: "appUsers", tableName: "zook_app_users" },
  { key: "roles", tableName: "zook_roles" },
  { key: "permissions", tableName: "zook_permissions" },
  { key: "rolePermissions", tableName: "zook_role_permissions" },
  { key: "userRoles", tableName: "zook_user_roles" },
  { key: "refreshTokens", tableName: "zook_refresh_tokens" },
  { key: "auditLogs", tableName: "zook_audit_logs" },
  { key: "notificationJobs", tableName: "zook_notification_jobs" },
  { key: "failedEvents", tableName: "zook_failed_events" },
  { key: "appConfigs", tableName: "zook_app_configs" },
  { key: "analyticsEvents", tableName: "zook_analytics_events" },
  { key: "files", tableName: "zook_files" },
  { key: "clientLogUploadTasks", tableName: "zook_client_log_upload_tasks" },
  { key: "clientLogUploads", tableName: "zook_client_log_uploads" },
  { key: "clientLogLines", tableName: "zook_client_log_lines" },
];

const DATABASE_LOCK_KEY = 20260401;

function buildSeedSnapshot(seed: DatabaseSeed): DatabaseStateSnapshot {
  return {
    apps: structuredClone(seed.apps ?? []),
    users: structuredClone(seed.users ?? []),
    appUsers: structuredClone(seed.appUsers ?? []),
    roles: structuredClone(seed.roles ?? []),
    permissions: structuredClone(seed.permissions ?? []),
    rolePermissions: structuredClone(seed.rolePermissions ?? []),
    userRoles: structuredClone(seed.userRoles ?? []),
    refreshTokens: structuredClone(seed.refreshTokens ?? []),
    auditLogs: structuredClone(seed.auditLogs ?? []),
    notificationJobs: structuredClone(seed.notificationJobs ?? []),
    failedEvents: structuredClone(seed.failedEvents ?? []),
    appConfigs: structuredClone(seed.appConfigs ?? []),
    analyticsEvents: structuredClone(seed.analyticsEvents ?? []),
    files: structuredClone(seed.files ?? []),
    clientLogUploadTasks: structuredClone(seed.clientLogUploadTasks ?? []),
    clientLogUploads: structuredClone(seed.clientLogUploads ?? []),
    clientLogLines: structuredClone(seed.clientLogLines ?? []),
  };
}

function isEmptySnapshot(snapshot: DatabaseStateSnapshot): boolean {
  return POSTGRES_COLLECTIONS.every(({ key }) => snapshot[key].length === 0);
}

function parsePayload<T>(value: unknown): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export class PostgresDatabase extends InMemoryDatabase {
  private readonly seedSnapshot: DatabaseStateSnapshot;
  private sessionDepth = 0;
  private initialized = false;

  private constructor(
    private readonly pool: Pool,
    seed: DatabaseSeed,
  ) {
    super(seed);
    this.seedSnapshot = buildSeedSnapshot(seed);
  }

  static async create(connectionString: string, seed: DatabaseSeed = {}): Promise<PostgresDatabase> {
    const pool = new Pool({
      connectionString,
    });
    const database = new PostgresDatabase(pool, seed);
    await database.initialize();
    return database;
  }

  override async withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.sessionDepth > 0) {
      this.sessionDepth += 1;
      try {
        return await fn();
      } finally {
        this.sessionDepth -= 1;
      }
    }

    const client = await this.pool.connect();
    this.sessionDepth = 1;

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [DATABASE_LOCK_KEY]);

      const loadedSnapshot = await this.loadSnapshot(client);
      const shouldSeed = !loadedSnapshot || isEmptySnapshot(loadedSnapshot);
      this.replaceState(shouldSeed ? this.seedSnapshot : loadedSnapshot);
      const initialFingerprint = JSON.stringify(this.cloneState());

      const result = await fn();
      const nextFingerprint = JSON.stringify(this.cloneState());

      if (shouldSeed || nextFingerprint !== initialFingerprint) {
        await this.persistSnapshot(client);
      }

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      this.sessionDepth = 0;
      client.release();
    }
  }

  override async close(): Promise<void> {
    await this.pool.end();
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.withExclusiveSession(async () => undefined);
    this.initialized = true;
  }

  private async loadSnapshot(client: PoolClient): Promise<DatabaseStateSnapshot | null> {
    const snapshot = buildSeedSnapshot({});
    let hasRows = false;

    for (const { key, tableName } of POSTGRES_COLLECTIONS) {
      const result = await client.query<{ payload: unknown }>(`SELECT payload FROM ${tableName} ORDER BY id ASC`);
      const rows = result.rows.map((row) => parsePayload(row.payload));
      if (rows.length > 0) {
        hasRows = true;
      }
      snapshot[key] = rows as never;
    }

    return hasRows ? snapshot : null;
  }

  private async persistSnapshot(client: PoolClient): Promise<void> {
    const snapshot = this.cloneState();

    for (const { key, tableName } of POSTGRES_COLLECTIONS) {
      const records = snapshot[key] as Array<{ id: string }>;
      await client.query(`DELETE FROM ${tableName}`);

      if (records.length === 0) {
        continue;
      }

      const batchSize = 100;
      for (let start = 0; start < records.length; start += batchSize) {
        const batch = records.slice(start, start + batchSize);
        const values: string[] = [];
        const parameters: Array<string> = [];

        batch.forEach((record, index) => {
          const parameterOffset = index * 2;
          values.push(`($${parameterOffset + 1}, $${parameterOffset + 2}::jsonb, NOW())`);
          parameters.push(record.id, JSON.stringify(record));
        });

        await client.query(
          `INSERT INTO ${tableName} (id, payload, updated_at) VALUES ${values.join(", ")}`,
          parameters,
        );
      }
    }
  }
}
