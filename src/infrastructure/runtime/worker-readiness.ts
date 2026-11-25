import { createServer } from "node:http";
import type { RedisJobQueue } from "../queue/bullmq/redis-queue.ts";
import { assertPostgresReady } from "./runtime-readiness.ts";

export function startWorkerReadiness(databaseUrl: string, queue: RedisJobQueue): void {
  let readinessCheck: Promise<boolean> | undefined;
  createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/readyz") {
      response.writeHead(404).end();
      return;
    }
    readinessCheck ??= Promise.allSettled([
      assertPostgresReady(databaseUrl, 1000),
      queue.assertReady(AbortSignal.timeout(1000)),
    ]).then((checks) => checks.every((check) => check.status === "fulfilled"))
      .finally(() => { readinessCheck = undefined; });
    const ready = await readinessCheck;
    response.writeHead(ready ? 200 : 503, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end(ready ? "ready\n" : "not ready\n");
  }).listen(Number(process.env.WORKER_READINESS_PORT || 3112), "127.0.0.1");
}
