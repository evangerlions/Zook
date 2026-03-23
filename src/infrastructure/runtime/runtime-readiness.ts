import { Client } from "pg";
import { KVManager } from "../kv/kv-manager.ts";

export async function assertRuntimeDependenciesReady(
  kvManager: KVManager,
  serviceName?: string,
): Promise<void> {
  if (!serviceName) {
    return;
  }

  if (!process.env.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required for runtime services.");
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required for runtime services.");
  }

  await kvManager.assertReady();
  await assertPostgresReady(process.env.DATABASE_URL.trim());
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
