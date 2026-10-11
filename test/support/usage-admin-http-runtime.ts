import { createServer } from "node:http";
import { createApplication } from "./create-test-application.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";

/** Explicit QA only: real route/auth/aggregation/credit-service; deterministic storage evidence. */
export async function startUsageAdminRuntime(port = 0) {
  const runtime = await createApplication({
    serviceName: "api",
    accessTokenSecret: "usage-admin-qa-only-32-character-secret",
    adminBasicAuth: { username: "usage-qa", password: "UsageQA-local-only!" },
  });
  const store = runtime.database
    .aiNovelCreditsStore as InMemoryAiNovelCreditsStore;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  let clock = new Date(day.getTime() - 20 * 86400_000);
  for (const [index, tier] of (
    ["free", "plus", "pro", "plus", "free", "pro"] as const
  ).entries()) {
    const userId = `qa_usage_${index + 1}`;
    const service = new AiNovelCreditsService(
      store,
      async () => tier,
      undefined,
      () => clock,
    );
    for (let week = 0; week < 3; week++) {
      clock = new Date(day.getTime() - (20 - week * 7) * 86400_000);
      await service.grant(userId, `week${week}`, 5);
      await service.begin(userId, `job${week}`, `request${week}`);
      await service.record(userId, `job${week}`, `request${week}`, {
        callId: `${userId}-call${week}`,
        modelKey: index % 2 ? "qa-model-premium" : "qa-model-fast",
        pointMicros: String(
          BigInt([15, 400, 3000, 1300, 30, 1000][index]!) * 1_000_000n,
        ),
        usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
        pricing: {
          inputPointsPerMillionTokens: 100,
          outputPointsPerMillionTokens: 100,
        },
      });
      await service.releaseRequest(userId, `job${week}`, `request${week}`);
      if (tier !== "free")
        store.reportPayments.push({
          userId,
          at: clock.toISOString(),
          kind: "purchase",
          currency: index % 2 ? "CNY" : "USD",
          amountMinor: tier === "plus" ? 3900 : 9900,
          sandbox: false,
          tier,
        });
    }
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    try {
      const handled = await runtime.app.handle({
        method: request.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(",") : v,
          ]),
        ),
        body: body ? JSON.parse(body) : undefined,
      });
      response.writeHead(handled.statusCode, {
        "Content-Type": "application/json",
        ...handled.headers,
      });
      response.end(JSON.stringify(handled.body));
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ code: "QA_RUNTIME_ERROR" }));
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing HTTP address");
  return {
    runtime,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

if (process.argv.includes("--serve")) {
  const server = await startUsageAdminRuntime(
    Number(process.env.USAGE_QA_PORT ?? 3197),
  );
  console.log(
    JSON.stringify({
      evidence: "usage-admin-qa",
      url: server.url,
      storage: "deterministic QA fixture, not production customers",
    }),
  );
}
