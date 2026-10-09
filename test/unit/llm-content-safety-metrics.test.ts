import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { InMemoryLlmObservabilityStore } from "../../src/testing/in-memory-llm-observability-store.ts";
import { PostgresLlmObservabilityStore } from "../../src/infrastructure/database/postgres/postgres-llm-observability.ts";
import { LlmMetricsService } from "../../src/services/llm-metrics.service.ts";
import { LlmHealthService } from "../../src/services/llm-health.service.ts";
import { LLMManager, type LLMProvider } from "../../src/services/llm-manager.ts";
import { LlmCallObservationRecorder } from "../../src/services/llm-call-observation.ts";
import type { LlmCallObservationRecord } from "../../src/infrastructure/database/llm-observability-store.ts";

const now = new Date("2026-10-09T02:00:00Z");
const normal: LlmCallObservationRecord = {
  callId: "business", occurredAt: now.toISOString(), routingModelKey: "qwen3.6-flash",
  provider: "test", providerModel: "qwen3.6-flash", operation: "chat", responseMode: "non_stream",
  outcome: "success", healthImpact: "success", totalLatencyMs: 100, totalTokens: 10, usageSource: "provider",
};

test("monitor excludes moderation from totals, timeline and all group denominators, not health", async () => {
  const store = new InMemoryLlmObservabilityStore();
  await store.recordObservation(normal);
  for (const [i, outcome] of ["success", "failure", "timeout", "cancelled"].entries()) {
    await store.recordObservation({ ...normal, callId: "moderation-" + i, callPurpose: "content_safety",
      outcome: outcome as LlmCallObservationRecord["outcome"], healthImpact: outcome === "cancelled" ? "neutral" : "failure",
      totalTokens: 1000, routingConfigRevision: 999 });
  }
  const metrics = new LlmMetricsService(store, new LlmHealthService(store));
  const config = { enabled: true, providers: [], models: [], defaultModelKey: "qwen3.6-flash",
    openRouter: { useTransparentProxy: false, transparentProxyBaseUrl: "", transparentProxyKeyId: "", transparentProxyHmacSecretKey: "" } };
  const overview = await metrics.getOverview(config, "24h", now);
  assert.equal(overview.summary.requestCount, 1);
  assert.equal(overview.summary.successRate, 100);
  assert.equal(overview.summary.totalTokens, 10);
  assert.equal(overview.items.reduce((sum, item) => sum + item.requestCount, 0), 1);
  for (const group of [overview.providerMetrics, overview.models, overview.routes, overview.crossMetrics]) {
    assert.equal(group.items[0].summary.requestCount, 1);
  }
  assert.equal(overview.routes.items[0].actualTrafficShare, 100);
  assert.equal(overview.healthFailures.items.length, 0);
  assert.equal(overview.routingConfigChangedWithinRange, false);
  const health = await store.getRouteHealth({ routingModelKey: normal.routingModelKey, provider: "test",
    providerModel: normal.providerModel, operation: "chat" });
  assert.equal(health?.totalCalls, 4);
  assert.equal(store.observations.length, 5);
});

test("LLM manager persists moderation purpose but still invokes and records upstream normally", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const provider: LLMProvider = {
    async complete(request) { return { provider: "test", modelKey: request.model.modelKey, providerModel: normal.providerModel, text: "ok" }; },
    async *stream() { yield { type: "done" } as const; },
  };
  const manager = new LLMManager({ test: provider },
    { "qwen3.6-flash": { provider: "test", providerModel: normal.providerModel } },
    { llmCallObservationRecorder: new LlmCallObservationRecorder(store) });
  await manager.complete({ modelKey: normal.routingModelKey, messages: [{ role: "user", content: "text" }], callPurpose: "content_safety" });
  await manager.complete({ modelKey: normal.routingModelKey, messages: [{ role: "user", content: "text" }] });
  assert.equal(store.observations[0].callPurpose, "content_safety");
  assert.equal(store.observations[1].callPurpose, undefined);
});

test("Postgres persists purpose and excludes it in every monitoring aggregate, but not route health", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresLlmObservabilityStore(async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [] };
  });
  await store.recordObservation({ ...normal, callPurpose: "content_safety" });
  assert.match(queries[0].sql, /routing_config_revision, call_purpose/);
  assert.equal(queries[0].values?.[20], "content_safety");
  queries.length = 0;
  await store.queryMetrics({ occurredAtFrom: "2026-10-08T00:00:00Z", occurredAtTo: now.toISOString(),
    granularity: "hour", excludeContentSafety: true });
  assert.equal(queries.length, 10);
  for (const query of queries) assert.match(query.sql, /call_purpose IS DISTINCT FROM 'content_safety'/);
  queries.length = 0;
  await store.getRouteHealth({ routingModelKey: normal.routingModelKey, provider: "test",
    providerModel: normal.providerModel, operation: "chat" });
  assert.ok(!queries[0].sql.includes("call_purpose"));
});

test("monitor UI states its moderation exclusion explicitly", () => {
  const view = readFileSync(new URL("../../apps/admin-web/app/components/llm-monitor/overview-section.tsx", import.meta.url), "utf8");
  assert.equal(view.match(/不包含已标记的内容审核调用/g)?.length, 2);
});
