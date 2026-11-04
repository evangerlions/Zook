import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { RevenueCatCustomerApi, RevenueCatApiError } from "../../src/services/ainovel-revenuecat-client.ts";

test("RC lookup logs status and correlation without credentials or response body", async () => {
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const api = new RevenueCatCustomerApi({ logger, secretApiKey: "SECRET_KEY", projectId: "proj_test", appId: "app_test",
    fetcher: async () => new Response("SECRET_RESPONSE", { status: 401 }) });
  await assert.rejects(api.getSnapshot("user-1", undefined, "req-1"),
    (error: unknown) => error instanceof RevenueCatApiError &&
      error.diagnostics.httpStatus === 401);
  const failure = logger.records.at(-1)!;
  assert.equal(failure.requestId, "req-1");
  assert.equal(failure.userId, "user-1");
  assert.equal(failure.httpStatus, 401);
  assert.equal(failure.failureKind, "http_error");
  assert.equal(typeof failure.durationMs, "number");
  assert.ok(!JSON.stringify(logger.records).includes("SECRET_"));
});

test("RC lookup distinguishes timeout and caller cancellation", async () => {
  for (const cancelled of [false, true]) {
    const logger = new StructuredLogger("test", { emitToConsole: false });
    const controller = new AbortController();
    const api = new RevenueCatCustomerApi({ logger, secretApiKey: "SECRET_KEY", projectId: "proj_test", appId: "app_test", timeoutMs: 5,
      fetcher: async (_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error("SECRET_NETWORK")), { once: true });
      }) });
    const pending = api.getSnapshot("user-1", controller.signal);
    if (cancelled) controller.abort();
    await assert.rejects(pending, RevenueCatApiError);
    assert.equal(logger.records.at(-1)!.failureKind, cancelled ? "request_cancelled" : "timeout");
    assert.ok(!JSON.stringify(logger.records).includes("SECRET_"));
  }
});

test("RC successful lookup logs duration without serializing receipt", async () => {
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const api = new RevenueCatCustomerApi({ logger, secretApiKey: "SECRET_KEY", projectId: "proj_test", appId: "app_test",
    fetcher: async () => Response.json({ object: "list", items: [], next_page: null, receipt: "SECRET_RECEIPT" }) });
  await api.getSnapshot("user-1", undefined, "req-2");
  assert.equal(logger.records.at(-1)!.httpStatus, 200);
  assert.ok(!JSON.stringify(logger.records).includes("SECRET_"));
});
