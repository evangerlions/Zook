import { createServer } from "node:http";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";

/** Local-only HTTP fixture serving the real Zook router against disposable in-memory data. */
export async function createJourneyServer(port = 0) {
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_FOCUS_MATCHING_ENABLED = "false";
  process.env.FROGSLEEP_BUDDY_GROUP_ENABLED = "false";
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "false";
  process.env.FROGSLEEP_BUDDY_EMAIL_ENABLED = "false";
  let runtime = await freshRuntime();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/__test__/health") { response.end(JSON.stringify({ fixture: "frogsleep-2a-journey", database: "memory" })); return; }
      if (url.pathname === "/__test__/reset" && request.method === "POST") {
        runtime = await freshRuntime(); response.end(JSON.stringify({ reset: true })); return;
      }
      if (url.pathname === "/__test__/notifications/tick" && request.method === "POST") {
        const result = await runtime.services.buddyNotificationWorkerService.processBatch();
        response.end(JSON.stringify(result)); return;
      }
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]));
      const result = await runtime.app.handle({ method: request.method ?? "GET", path: url.pathname, headers,
        query: Object.fromEntries(url.searchParams), body: await readRequestBody(request, request.headers["content-type"]), ipAddress: "127.0.0.1" });
      response.statusCode = result.statusCode;
      response.setHeader("Content-Type", "application/json");
      for (const [key, value] of Object.entries(result.headers ?? {})) response.setHeader(key, value);
      response.end(JSON.stringify(result.body));
    } catch { response.statusCode = 500; response.end(JSON.stringify({ fixture_error: true })); }
  });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, server, database: () => runtime.database,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
async function freshRuntime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
}
if (process.argv[1]?.endsWith("frogsleep-journey-server.ts")) {
  const fixture = await createJourneyServer(Number(process.env.FROGSLEEP_JOURNEY_PORT ?? 3197));
  process.stdout.write(JSON.stringify({ fixture_url: fixture.url, database: "memory" }) + "\n");
  process.once("SIGTERM", () => { void fixture.close().then(() => process.exit(0)); });
}
