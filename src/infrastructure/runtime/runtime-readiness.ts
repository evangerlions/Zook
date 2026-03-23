import { existsSync } from "node:fs";
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

export function resolveRuntimeRedisUrl(
  rawValue = process.env.REDIS_URL,
  insideContainer = isContainerRuntime(),
): string | undefined {
  return normalizeRuntimeUrl(rawValue, insideContainer);
}

export function resolveRuntimeDatabaseUrl(
  rawValue = process.env.DATABASE_URL,
  insideContainer = isContainerRuntime(),
): string | undefined {
  return normalizeRuntimeUrl(rawValue, insideContainer);
}

export function isContainerRuntime(): boolean {
  return (
    existsSync("/.dockerenv") ||
    Boolean(process.env.KUBERNETES_SERVICE_HOST) ||
    Boolean(process.env.CONTAINER) ||
    Boolean(process.env.CONTAINER_SANDBOX_MOUNT_POINT)
  );
}

function normalizeRuntimeUrl(rawValue: string | undefined, insideContainer: boolean): string | undefined {
  const normalized = rawValue?.trim();
  if (!normalized) {
    return undefined;
  }

  if (!insideContainer) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    if (!isLoopbackHost(url.hostname)) {
      return normalized;
    }

    url.hostname = "host.docker.internal";
    return url.toString();
  } catch {
    return normalized;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}
