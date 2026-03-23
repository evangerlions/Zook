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

export function resolveRuntimeRedisUrl(rawValue = process.env.REDIS_URL): string | undefined {
  return rewriteLoopbackRuntimeUrl(rawValue);
}

export function resolveRuntimeDatabaseUrl(rawValue = process.env.DATABASE_URL): string | undefined {
  return rewriteLoopbackRuntimeUrl(rawValue);
}

function rewriteLoopbackRuntimeUrl(rawValue?: string): string | undefined {
  const normalized = rawValue?.trim();
  if (!normalized) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return normalized;
  }

  if (!isContainerRuntime()) {
    return normalized;
  }

  if (resolveContainerNetworkMode() === "host") {
    return normalized;
  }

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
    url.hostname = process.env.RUNTIME_HOST_GATEWAY?.trim() || "host.docker.internal";
  }

  return url.toString();
}

function isContainerRuntime(): boolean {
  return existsSync("/.dockerenv") || process.env.CONTAINERIZED_RUNTIME === "1";
}

function resolveContainerNetworkMode(rawValue = process.env.CONTAINER_NETWORK_MODE): string {
  const normalized = rawValue?.trim().toLowerCase();
  if (normalized === "host") {
    return "host";
  }
  return "bridge";
}
