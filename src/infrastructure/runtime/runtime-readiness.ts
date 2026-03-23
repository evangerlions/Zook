import { Client } from "pg";
import { KVManager } from "../kv/kv-manager.ts";

export async function assertRuntimeDependenciesReady(
  kvManager: KVManager,
  serviceName?: string,
): Promise<void> {
  if (!serviceName) {
    return;
  }

  const redisUrl = resolveRuntimeRedisUrl();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for runtime services.");
  }

  const databaseUrl = resolveRuntimeDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for runtime services.");
  }

  await kvManager.assertReady();
  await assertPostgresReady(databaseUrl);
}

async function assertPostgresReady(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function resolveRuntimeRedisUrl(rawValue = process.env.REDIS_URL): string | undefined {
  return normalizeRuntimeUrl(rawValue);
}

export function resolveRuntimeDatabaseUrl(rawValue = process.env.DATABASE_URL): string | undefined {
  return normalizeRuntimeUrl(rawValue);
}

function normalizeRuntimeUrl(rawValue?: string): string | undefined {
  const normalized = rawValue?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}
