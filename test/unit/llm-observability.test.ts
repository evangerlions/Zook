import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryLlmObservabilityStore } from "../../src/testing/in-memory-llm-observability-store.ts";
import { LlmCallObservationRecorder } from "../../src/services/llm-call-observation.ts";
import { LlmHealthService } from "../../src/services/llm-health.service.ts";
import { LlmMetricsService } from "../../src/services/llm-metrics.service.ts";
import { evaluateLlmRoutes, selectLlmRoute } from "../../src/services/llm-routing-score.ts";
import { LLMManager, type LLMProvider, type LLMStreamEvent } from "../../src/services/llm-manager.ts";

test("llm observation store records 1000 concurrent calls without loss and ignores duplicate call ids", async () => {
  const store = new InMemoryLlmObservabilityStore();
  await Promise.all(Array.from({ length: 1000 }, (_, index) => store.recordObservation({
    callId: `call_${index}`,
    occurredAt: new Date(1_800_000_000_000 + index).toISOString(),
    routingModelKey: "model-a",
    provider: "provider-a",
    providerModel: "upstream-a",
    operation: "chat",
    responseMode: "non_stream",
    outcome: "success",
    healthImpact: "success",
    totalLatencyMs: 100 + index,
    totalTokens: 10,
    usageSource: "provider",
  })));
  assert.equal(store.observations.length, 1000);
  assert.equal(await store.recordObservation({ ...store.observations[0]! }), false);
  assert.equal(store.observations.length, 1000);
});

test("llm metrics keep canonical totals and do not double-count reasoning tokens", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const metrics = new LlmMetricsService(store, health);
  const occurredAt = new Date("2026-08-25T10:00:00+08:00");
  for (const [index, latency] of [100, 200, 300, 400].entries()) {
    await store.recordObservation({
      callId: `usage_${index}`,
      occurredAt: occurredAt.toISOString(),
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "stream",
      outcome: "success",
      healthImpact: "success",
      firstResponseLatencyMs: latency / 2,
      totalLatencyMs: latency,
      promptTokens: 10,
      completionTokens: 30,
      reasoningTokens: 20,
      totalTokens: 40,
      usageSource: "provider",
    });
  }
  const overview = await metrics.getOverview(
    emptyConfig(),
    "48h",
    new Date("2026-08-25T11:00:00+08:00"),
    { operation: "chat" },
  );
  assert.equal(overview.summary.promptTokens, 40);
  assert.equal(overview.summary.visibleOutputTokens, 40);
  assert.equal(overview.summary.reasoningTokens, 80);
  assert.equal(overview.summary.unclassifiedTokens, 0);
  assert.equal(overview.summary.totalTokens, 160);
  assert.equal(overview.summary.p50TotalLatencyMs, 200);
  assert.equal(overview.summary.p95TotalLatencyMs, 400);
  const allOperations = await metrics.getOverview(
    emptyConfig(),
    "48h",
    new Date("2026-08-25T11:00:00+08:00"),
  );
  assert.equal(allOperations.summary.p50TotalLatencyMs, undefined);
  assert.equal(allOperations.items.some((item) => item.p50TotalLatencyMs !== undefined), false);
  assert.equal(allOperations.latencyByOperation.chat?.p50TotalLatencyMs, 200);
});

test("neutral cancellation does not advance health warm-up", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const recorder = new LlmCallObservationRecorder(store);
  const session = recorder.start({
    routingModelKey: "model-a",
    provider: "provider-a",
    providerModel: "upstream-a",
    operation: "chat",
    responseMode: "stream",
    startedAt: new Date("2026-08-25T00:00:00.000Z"),
    now: () => new Date("2026-08-25T00:00:01.000Z"),
  });
  await session.finalize({ outcome: "cancelled" });
  const snapshot = await health.getRouteSnapshot({
    modelKey: "model-a",
    provider: "provider-a",
    providerModel: "upstream-a",
    operation: "chat",
  });
  assert.equal(snapshot.totalCalls, 0);
  assert.equal(snapshot.sampleSize, 0);
  assert.equal(snapshot.healthScore, 100);
});

test("TTFT includes streams that produced content before failure or cancellation", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const metrics = new LlmMetricsService(store, health);
  for (const [index, outcome, firstResponseLatencyMs] of [
    [0, "success", 100],
    [1, "failure", 600],
    [2, "cancelled", 1000],
  ] as const) {
    await store.recordObservation({
      callId: `ttft_${index}`,
      occurredAt: new Date(`2026-08-25T0${index + 1}:00:00.000Z`).toISOString(),
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "stream",
      outcome,
      healthImpact: outcome === "cancelled" ? "neutral" : outcome,
      firstResponseLatencyMs,
      totalLatencyMs: firstResponseLatencyMs + 100,
      usageSource: "missing",
    });
  }
  const overview = await metrics.getOverview(
    emptyConfig(),
    "48h",
    new Date("2026-08-25T05:00:00.000Z"),
    { operation: "chat" },
  );
  assert.equal(overview.summary.firstResponseSampleCount, 3);
  assert.equal(overview.summary.p50FirstByteLatencyMs, 600);
  assert.equal(overview.summary.p95FirstByteLatencyMs, 1000);
});

test("metrics flag routing configuration changes inside the selected range", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const metrics = new LlmMetricsService(store, health);
  for (const revision of [1, 2]) {
    await store.recordObservation({
      callId: `revision_${revision}`,
      occurredAt: new Date(`2026-08-25T0${revision}:00:00.000Z`).toISOString(),
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "non_stream",
      outcome: "success",
      healthImpact: "success",
      totalLatencyMs: 100,
      usageSource: "missing",
      routingConfigRevision: revision,
    });
  }
  const overview = await metrics.getOverview(
    emptyConfig(),
    "48h",
    new Date("2026-08-25T04:00:00.000Z"),
    { configRevision: 2 },
  );
  assert.equal(overview.routingConfigChangedWithinRange, true);

  const operationStore = new InMemoryLlmObservabilityStore();
  const operationMetrics = new LlmMetricsService(operationStore, new LlmHealthService(operationStore));
  for (const [callId, operation, revision] of [
    ["chat_r2", "chat", 2],
    ["embedding_r1", "embedding", 1],
  ] as const) {
    await operationStore.recordObservation({
      callId,
      occurredAt: "2026-08-25T02:00:00.000Z",
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation,
      responseMode: "non_stream",
      outcome: "success",
      healthImpact: "success",
      totalLatencyMs: 100,
      usageSource: "missing",
      routingConfigRevision: revision,
    });
  }
  const chatOnly = await operationMetrics.getOverview(
    emptyConfig(), "48h", new Date("2026-08-25T04:00:00.000Z"),
    { operation: "chat", configRevision: 2, configUpdatedAt: "2026-08-20T00:00:00.000Z" },
  );
  assert.equal(chatOnly.routingConfigChangedWithinRange, false);
  const recentlyChanged = await operationMetrics.getOverview(
    emptyConfig(), "48h", new Date("2026-08-25T04:00:00.000Z"),
    { operation: "chat", configRevision: 2, configUpdatedAt: "2026-08-25T03:00:00.000Z" },
  );
  assert.equal(recentlyChanged.routingConfigChangedWithinRange, true);
});

test("provider filters do not change routing-share denominators and cross cells merge routing models", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const metrics = new LlmMetricsService(store, health);
  const records = [
    ["a_1", "routing-a", "provider-a", "shared-model"],
    ["a_2", "routing-b", "provider-a", "shared-model"],
    ["b_1", "routing-a", "provider-b", "other-model"],
  ] as const;
  for (const [callId, routingModelKey, provider, providerModel] of records) {
    await store.recordObservation({
      callId,
      occurredAt: "2026-08-25T02:00:00.000Z",
      routingModelKey,
      provider,
      providerModel,
      operation: "chat",
      responseMode: "non_stream",
      outcome: "success",
      healthImpact: "success",
      totalLatencyMs: 100,
      totalTokens: 10,
      usageSource: "provider",
    });
  }
  const overview = await metrics.getOverview(
    emptyConfig(),
    "48h",
    new Date("2026-08-25T04:00:00.000Z"),
    { provider: "provider-a", operation: "chat" },
  );
  assert.equal(overview.summary.requestCount, 2);
  assert.equal(overview.routes.items.find((item) => item.provider === "provider-a" && item.routingModelKey === "routing-a")?.actualTrafficShare, 50);
  assert.equal(overview.routes.items.find((item) => item.provider === "provider-b")?.actualTrafficShare, 50);
  assert.equal(overview.crossMetrics.items.find((item) => item.provider === "provider-a" && item.providerModel === "shared-model")?.summary.requestCount, 2);
  assert.equal(overview.providerMetrics.items[0]?.trafficShare, 66.67);
  assert.deepEqual(overview.providerMetrics.items.map((item) => item.provider), ["provider-a"]);
});

test("stream early return finalizes exactly once as cancelled", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  const metrics = new LlmMetricsService(store, health);
  const provider: LLMProvider = {
    async complete(request) {
      return { provider: "test", modelKey: request.model.modelKey, providerModel: "upstream-a", text: "ok" };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: "content_delta", text: "first" };
      yield { type: "content_delta", text: "second" };
      yield { type: "done" };
    },
  };
  const manager = new LLMManager(
    { test: provider },
    { "model-a": { provider: "test", providerModel: "upstream-a" } },
    { llmHealthService: health, llmMetricsService: metrics },
  );
  for await (const event of manager.stream({
    modelKey: "model-a",
    messages: [{ role: "user", content: "hello" }],
  })) {
    if (event.type === "content_delta") break;
  }
  assert.equal(store.observations.length, 1);
  assert.equal(store.observations[0]?.outcome, "cancelled");
  assert.equal(store.observations[0]?.healthImpact, "neutral");
});

test("telemetry persistence failure does not fail a successful completion", async () => {
  const recorder = new LlmCallObservationRecorder({
    async recordObservation() { throw new Error("database unavailable"); },
    async getRouteHealth() { return undefined; },
    async queryMetrics() { throw new Error("unused"); },
    async deleteBefore() { return { observations: 0 }; },
  });
  const provider: LLMProvider = {
    async complete(request) {
      return { provider: "test", modelKey: request.model.modelKey, providerModel: "upstream-a", text: "ok" };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> { yield { type: "done" }; },
  };
  const manager = new LLMManager(
    { test: provider },
    { "model-a": { provider: "test", providerModel: "upstream-a" } },
    { llmCallObservationRecorder: recorder },
  );
  assert.equal((await manager.complete({
    modelKey: "model-a",
    messages: [{ role: "user", content: "hello" }],
  })).text, "ok");
});

test("routing evaluation uses rounded health score for selector and API values", async () => {
  const store = new InMemoryLlmObservabilityStore();
  const health = new LlmHealthService(store);
  for (let index = 0; index < 11; index += 1) {
    await store.recordObservation({
      callId: `rounding_${index}`,
      occurredAt: new Date(1_800_000_000_000 + index).toISOString(),
      routingModelKey: "model-a",
      provider: "a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "non_stream",
      outcome: index < 10 ? "success" : "failure",
      healthImpact: index < 10 ? "success" : "failure",
      totalLatencyMs: 20,
      usageSource: "missing",
    });
  }
  const healthScore = (await health.getRouteSnapshot({
    modelKey: "model-a",
    provider: "a",
    providerModel: "upstream-a",
  })).healthScore;
  assert.equal(healthScore, 90.91);
  const evaluation = evaluateLlmRoutes("auto", [
    { route: { provider: "a", providerModel: "upstream-a", enabled: true, weight: 50 }, providerEnabled: true, runtimeAvailable: true, healthScore },
    { route: { provider: "b", providerModel: "upstream-b", enabled: true, weight: 50 }, providerEnabled: true, runtimeAvailable: true, healthScore: 100 },
  ]);
  assert.equal(evaluation.routes[0]?.dynamicScore, 45.455);
  assert.equal(selectLlmRoute(evaluation, () => 0)?.route.provider, "a");
  assert.equal(selectLlmRoute(evaluation, () => 0.47)?.route.provider, "a");
  assert.equal(selectLlmRoute(evaluation, () => 0.48)?.route.provider, "b");
});

test("routing evaluation exposes auto fallback, zero-score boundary, and fixed compatibility fallback", () => {
  const zeroBoundary = evaluateLlmRoutes("auto", [
    { route: { provider: "zero", providerModel: "zero", enabled: true, weight: 50 }, providerEnabled: true, runtimeAvailable: true, healthScore: 0 },
    { route: { provider: "healthy", providerModel: "healthy", enabled: true, weight: 50 }, providerEnabled: true, runtimeAvailable: true, healthScore: 100 },
  ]);
  assert.equal(selectLlmRoute(zeroBoundary, () => 0)?.route.provider, "healthy");

  const staticFallback = evaluateLlmRoutes("auto", [
    { route: { provider: "a", providerModel: "a", enabled: true, weight: 80 }, providerEnabled: true, runtimeAvailable: true, healthScore: 0 },
    { route: { provider: "b", providerModel: "b", enabled: true, weight: 20 }, providerEnabled: true, runtimeAvailable: true, healthScore: 0 },
  ]);
  assert.equal(staticFallback.routes[0]?.selectionReason, "static_weight_fallback");
  assert.equal(staticFallback.routes[0]?.effectiveProbability, 80);

  const fixedFallback = evaluateLlmRoutes("fixed", [
    { route: { provider: "disabled", providerModel: "first", enabled: false, weight: 20 }, providerEnabled: false, runtimeAvailable: true, healthScore: 10 },
    { route: { provider: "disabled-2", providerModel: "second", enabled: false, weight: 80 }, providerEnabled: false, runtimeAvailable: true, healthScore: 100 },
  ]);
  assert.equal(fixedFallback.routes[0]?.selectionReason, "compatibility_fallback");
  assert.equal(fixedFallback.routes[0]?.effectiveProbability, 100);
});

test("runtime provider availability is operation-specific", async () => {
  const health = new LlmHealthService(new InMemoryLlmObservabilityStore(), {
    chat: new Set(),
    embedding: new Set(["provider-a"]),
  });
  const provider = { key: "provider-a", label: "A", enabled: true, baseUrl: "https://example.invalid", apiKey: "test", timeoutMs: 1000 };
  const route = { provider: "provider-a", providerModel: "model-a", enabled: true, weight: 100 };
  const chat = await health.buildModelRuntimeStatus(
    { key: "chat-a", label: "Chat", kind: "chat", strategy: "fixed", routes: [route] },
    [provider],
  );
  const embedding = await health.buildModelRuntimeStatus(
    { key: "embedding-a", label: "Embedding", kind: "embedding", strategy: "fixed", routes: [route] },
    [provider],
  );
  assert.equal(chat.routes[0]?.runtimeAvailable, false);
  assert.equal(embedding.routes[0]?.runtimeAvailable, true);
});

function emptyConfig() {
  return {
    enabled: true,
    defaultModelKey: "model-a",
    openRouter: {
      useTransparentProxy: false,
      transparentProxyBaseUrl: "",
      transparentProxyKeyId: "",
      transparentProxyHmacSecretKey: "",
    },
    providers: [
      { key: "provider-a", label: "Provider A", enabled: true, baseUrl: "https://example.invalid", apiKey: "test", timeoutMs: 1000 },
      { key: "provider-b", label: "Provider B", enabled: true, baseUrl: "https://example.invalid", apiKey: "test", timeoutMs: 1000 },
    ],
    models: [],
  };
}
