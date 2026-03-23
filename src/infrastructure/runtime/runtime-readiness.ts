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

  console.log(`[runtime:readiness] 正在执行运行时依赖检查，serviceName=${serviceName}`);
  console.log("[runtime:readiness] 正在解析 REDIS_URL");
  const redisUrl = resolveRuntimeRedisUrl();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for runtime services.");
  }
  console.log(`[runtime:readiness] REDIS_URL 解析完成，url=${redactUrlForLogs(redisUrl)}`);

  console.log("[runtime:readiness] 正在解析 DATABASE_URL");
  const databaseUrl = resolveRuntimeDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for runtime services.");
  }
  console.log(`[runtime:readiness] DATABASE_URL 解析完成，url=${redactUrlForLogs(databaseUrl)}`);

  console.log("[runtime:readiness] 正在执行 Redis 连通性检查");
  await kvManager.assertReady();
  console.log("[runtime:readiness] Redis 连通性检查完成");

  console.log("[runtime:readiness] 正在执行 PostgreSQL 连通性检查");
  await assertPostgresReady(databaseUrl);
  console.log("[runtime:readiness] PostgreSQL 连通性检查完成");
  console.log(`[runtime:readiness] 运行时依赖检查完成，serviceName=${serviceName}`);
}

async function assertPostgresReady(connectionString: string): Promise<void> {
  console.log(
    `[runtime:readiness] 正在执行 PostgreSQL connect/query，url=${redactUrlForLogs(connectionString)}`,
  );
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
  console.log("[runtime:readiness] PostgreSQL connect/query 完成");
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

    console.log(
      `[runtime:readiness] 检测到容器环境，正在将 ${url.hostname} 自动替换为 host.docker.internal，url=${redactUrlForLogs(normalized)}`,
    );
    url.hostname = "host.docker.internal";
    console.log(
      `[runtime:readiness] 容器环境地址替换完成，url=${redactUrlForLogs(url.toString())}`,
    );
    return url.toString();
  } catch {
    return normalized;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function redactUrlForLogs(rawValue: string): string {
  try {
    const url = new URL(rawValue);
    if (url.password) {
      url.password = "****";
    }
    return url.toString();
  } catch {
    return rawValue;
  }
}
