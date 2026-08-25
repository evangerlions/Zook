import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { EmbeddingManager, type EmbeddingResult } from "../../src/services/embedding-manager.ts";
import { LlmHealthService } from "../../src/services/llm-health.service.ts";
import { LLMManager, type LLMCompletionResult, type LLMProvider, type LLMStreamEvent, type LLMUsage } from "../../src/services/llm-manager.ts";
import { LlmMetricsService } from "../../src/services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "../../src/services/llm-smoke-test.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";

async function createLlmFixture() {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const database = new InMemoryDatabase();
  const cache = new InMemoryCache();
  const appConfigService = new VersionedAppConfigService(database, cache, kvManager);
  const passwordManager = new PasswordManager(kvManager);
  const commonPasswordConfigService = new CommonPasswordConfigService(passwordManager);
  const secretReferenceResolver = new SecretReferenceResolver(commonPasswordConfigService);
  const commonLlmConfigService = new CommonLlmConfigService(appConfigService, secretReferenceResolver);
  const llmHealthService = new LlmHealthService(database.llmObservabilityStore);
  const llmMetricsService = new LlmMetricsService(
    database.llmObservabilityStore,
    llmHealthService,
  );

  return {
    kvManager,
    database,
    appConfigService,
    commonPasswordConfigService,
    commonLlmConfigService,
    llmHealthService,
    llmMetricsService,
  };
}

let metricSeedSequence = 0;
let healthSeedSequence = 0;

async function recordMetricCall(
  fixture: Awaited<ReturnType<typeof createLlmFixture>>,
  event: {
    modelKey: string;
    provider: string;
    providerModel: string;
    ok: boolean;
    firstByteLatencyMs?: number;
    totalLatencyMs: number;
    usage?: LLMUsage;
    occurredAt: Date;
  },
) {
  metricSeedSequence += 1;
  await fixture.database.llmObservabilityStore.recordObservation({
    callId: `metric_seed_${metricSeedSequence}`,
    occurredAt: event.occurredAt.toISOString(),
    routingModelKey: event.modelKey,
    provider: event.provider,
    providerModel: event.providerModel,
    operation: "chat",
    responseMode: event.firstByteLatencyMs === undefined ? "non_stream" : "stream",
    outcome: event.ok ? "success" : "failure",
    healthImpact: event.ok ? "success" : "failure",
    firstResponseLatencyMs: event.firstByteLatencyMs,
    totalLatencyMs: event.totalLatencyMs,
    promptTokens: event.usage?.promptTokens,
    completionTokens: event.usage?.completionTokens,
    reasoningTokens: event.usage?.reasoningTokens,
    totalTokens: event.usage?.totalTokens,
    usageSource: event.usage ? event.usage.estimated ? "estimated" : "provider" : "missing",
  });
}

async function recordHealthResult(
  fixture: Awaited<ReturnType<typeof createLlmFixture>>,
  route: { modelKey: string; provider: string; providerModel: string },
  result: { ok: boolean; timestamp?: string; firstByteLatencyMs?: number; totalLatencyMs: number },
) {
  healthSeedSequence += 1;
  await fixture.database.llmObservabilityStore.recordObservation({
    callId: `health_seed_${healthSeedSequence}`,
    occurredAt: result.timestamp ?? new Date().toISOString(),
    routingModelKey: route.modelKey,
    provider: route.provider,
    providerModel: route.providerModel,
    operation: "chat",
    responseMode: "non_stream",
    outcome: result.ok ? "success" : "failure",
    healthImpact: result.ok ? "success" : "failure",
    totalLatencyMs: result.totalLatencyMs,
    usageSource: "missing",
  });
}

function createMockProvider(name: string, calls: string[]): LLMProvider {
  return {
    async complete(request): Promise<LLMCompletionResult> {
      calls.push(name);
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: `${name}:ok`,
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "done",
      };
    },
  };
}

test("llm manager keeps routes healthy before 10 calls and then lowers traffic for unhealthy auto routes", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "volcengine",
        label: "火山",
        enabled: true,
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "mock-volc-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 80,
          },
          {
            provider: "volcengine",
            providerModel: "kimi-2.5",
            enabled: true,
            weight: 20,
          },
        ],
      },
    ],
  });

  const calls: string[] = [];
  const manager = new LLMManager(
    {
      bailian: createMockProvider("bailian", calls),
      volcengine: createMockProvider("volcengine", calls),
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
      random: () => 0.95,
      now: () => new Date("2026-03-24T10:00:00+08:00"),
    },
  );

  for (let count = 0; count < 9; count += 1) {
    await recordHealthResult(fixture,
      {
        modelKey: "kimi2.5",
        provider: "volcengine",
        providerModel: "kimi-2.5",
      },
      {
        ok: false,
        timestamp: `2026-03-24T09:0${count}:00+08:00`,
        firstByteLatencyMs: 100,
        totalLatencyMs: 300,
      },
    );
  }

  await manager.complete({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(calls.at(-1), "volcengine");

  await recordHealthResult(fixture,
    {
      modelKey: "kimi2.5",
      provider: "volcengine",
      providerModel: "kimi-2.5",
    },
    {
      ok: false,
      timestamp: "2026-03-24T09:30:00+08:00",
      firstByteLatencyMs: 100,
      totalLatencyMs: 300,
    },
  );

  await manager.complete({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "hello again" }],
  });
  assert.equal(calls.at(-1), "bailian");
});

test("llm manager fixed strategy ignores health score and always picks the highest-weight route", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "volcengine",
        label: "火山",
        enabled: true,
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "mock-volc-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 20,
          },
          {
            provider: "volcengine",
            providerModel: "kimi-2.5",
            enabled: true,
            weight: 80,
          },
        ],
      },
    ],
  });

  for (let count = 0; count < 25; count += 1) {
    await recordHealthResult(fixture,
      {
        modelKey: "kimi2.5",
        provider: "volcengine",
        providerModel: "kimi-2.5",
      },
      {
        ok: false,
        timestamp: `2026-03-24T08:${String(count).padStart(2, "0")}:00+08:00`,
        firstByteLatencyMs: 100,
        totalLatencyMs: 300,
      },
    );
  }

  const calls: string[] = [];
  const manager = new LLMManager(
    {
      bailian: createMockProvider("bailian", calls),
      volcengine: createMockProvider("volcengine", calls),
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
    },
  );

  await manager.complete({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "fixed mode" }],
  });

  assert.equal(calls.at(-1), "volcengine");
});

test("common llm config service runtime follows latest revision even if direct config record is stale", async () => {
  const fixture = await createLlmFixture();

  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  const staleRecord = fixture.database.appConfigs.find(
    (item) => item.appId === "common" && item.configKey === "common.llm_service",
  );
  assert.ok(staleRecord);
  staleRecord.configValue = JSON.stringify({
    enabled: false,
    defaultModelKey: "",
    providers: [],
    models: [],
  });
  staleRecord.updatedAt = "2026-04-03T10:00:00.000Z";

  const document = await fixture.commonLlmConfigService.getDocument();
  assert.equal(document.config.enabled, true);
  assert.equal(document.config.defaultModelKey, "kimi2.5");

  const runtimeConfig = await fixture.commonLlmConfigService.getRuntimeConfig();
  assert.equal(runtimeConfig?.enabled, true);
  assert.equal(runtimeConfig?.defaultModelKey, "kimi2.5");
  assert.equal(runtimeConfig?.providers[0]?.key, "bailian");
  const runtimeSnapshot = await fixture.commonLlmConfigService.getRuntimeConfigSnapshot();
  assert.equal(runtimeSnapshot?.revision, document.revision);
  assert.equal(runtimeSnapshot?.updatedAt, document.updatedAt);
  assert.equal(runtimeSnapshot?.config.defaultModelKey, document.config.defaultModelKey);
});

test("llm manager resolves {{zook.ps.xxx}} apiKey references from password workspace", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonPasswordConfigService.updateConfig({
    items: [
      {
        key: "bailian.api_key",
        desc: "百炼 API Key",
        value: "resolved-bailian-key",
      },
    ],
  });

  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "{{zook.ps.bailian.api_key}}",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  let resolvedApiKey = "";
  const manager = new LLMManager(
    {
      bailian: {
        async complete(request): Promise<LLMCompletionResult> {
          resolvedApiKey = request.model.providerConfig?.apiKey ?? "";
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            text: "ok",
          };
        },
        async *stream(): AsyncIterable<LLMStreamEvent> {
          yield {
            type: "done",
          };
        },
      },
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
    },
  );

  await manager.complete({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(resolvedApiKey, "resolved-bailian-key");
});

test("llm manager records AINovel scene route keys under concrete model keys", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "ainovel-premium-creative",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "ainovel-premium-creative",
        label: "AINovel Premium Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "glm-5",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  const manager = new LLMManager(
    {
      bailian: {
        async complete(request): Promise<LLMCompletionResult> {
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            text: "ok",
          };
        },
        async *stream(): AsyncIterable<LLMStreamEvent> {
          yield { type: "done" };
        },
      },
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
      now: () => new Date("2026-03-24T10:20:00+08:00"),
    },
  );

  await manager.complete({
    modelKey: "ainovel-premium-creative",
    messages: [{ role: "user", content: "hello" }],
  });

  const overview = await fixture.llmMetricsService.getOverview(
    await fixture.commonLlmConfigService.getCurrentConfig(),
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(overview.models.items.some((item) => item.modelKey === "ainovel-premium-creative"), false);
  assert.equal(overview.models.items[0]?.modelKey, "glm-5");
  assert.equal(overview.models.items[0]?.summary.requestCount, 1);
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "ainovel-premium-creative",
        provider: "bailian",
        providerModel: "glm-5",
      })
    ).totalCalls,
    1,
  );
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "glm-5",
        provider: "bailian",
        providerModel: "glm-5",
      })
    ).totalCalls,
    0,
  );
});

test("llm manager resolves AINovel route aliases through configured concrete model routes", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "qwen3.6-plus",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "bailian_coding",
        label: "百炼 Coding Plan",
        enabled: true,
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "mock-coding-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "ainovel-plus-reasoning",
        label: "stale AINovel Plus Reasoning",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "qwen3.6-plus",
        label: "qwen3.6-plus",
        kind: "chat",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 1,
          },
          {
            provider: "bailian_coding",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 99,
          },
        ],
      },
    ],
  });

  const calls: string[] = [];
  const manager = new LLMManager(
    {
      bailian: createMockProvider("bailian", calls),
      bailian_coding: createMockProvider("bailian_coding", calls),
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
      random: () => 0.5,
      now: () => new Date("2026-03-24T10:20:00+08:00"),
    },
  );

  const result = await manager.complete({
    modelKey: "ainovel-plus-reasoning",
    modelKeyKind: "scene_route",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.deepEqual(calls, ["bailian_coding"]);
  assert.equal(result.modelKey, "ainovel-plus-reasoning");
  assert.equal(result.provider, "bailian_coding");
  assert.equal(result.providerModel, "qwen3.6-plus");
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "qwen3.6-plus",
        provider: "bailian_coding",
        providerModel: "qwen3.6-plus",
      })
    ).totalCalls,
    1,
  );

  const detail = await fixture.llmMetricsService.getModelDetail(
    await fixture.commonLlmConfigService.getCurrentConfig(),
    "qwen3.6-plus",
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(detail.summary.requestCount, 1);
  assert.equal(
    detail.routes.find((item) => item.provider === "bailian_coding")?.summary.requestCount,
    1,
  );
  assert.equal(detail.routes.some((item) => item.provider === "bailian"), false);
});

test("embedding manager records AINovel scene route keys under concrete model keys", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "qwen3.6-plus",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "qwen3.6-plus",
        label: "Qwen 3.6 Plus",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-embedding-default",
        label: "AINovel Embedding Default",
        kind: "embedding",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  const manager = new EmbeddingManager(
    {
      bailian: {
        async embed(request): Promise<EmbeddingResult> {
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            vectors: [{ index: 0, embedding: [0.1, 0.2] }],
          };
        },
      },
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
      now: () => new Date("2026-03-24T10:20:00+08:00"),
    },
  );

  await manager.embed({
    modelKey: "ainovel-embedding-default",
    input: ["hello"],
  });

  const overview = await fixture.llmMetricsService.getOverview(
    await fixture.commonLlmConfigService.getCurrentConfig(),
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(overview.models.items.some((item) => item.modelKey === "ainovel-embedding-default"), false);
  assert.equal(overview.models.items[0]?.modelKey, "text-embedding-v4");
  assert.equal(overview.models.items[0]?.summary.requestCount, 1);
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "ainovel-embedding-default",
        provider: "bailian",
        providerModel: "text-embedding-v4",
        operation: "embedding",
      })
    ).totalCalls,
    1,
  );
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "text-embedding-v4",
        provider: "bailian",
        providerModel: "text-embedding-v4",
        operation: "embedding",
      })
    ).totalCalls,
    0,
  );
});

test("embedding manager resolves AINovel route aliases through configured concrete model routes", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "qwen3.6-plus",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "bailian_coding",
        label: "百炼 Coding Plan",
        enabled: true,
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "mock-coding-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "qwen3.6-plus",
        label: "qwen3.6-plus",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-embedding-default",
        label: "stale AINovel Embedding Default",
        kind: "embedding",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "text-embedding-v4",
        label: "text-embedding-v4",
        kind: "embedding",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 1,
          },
          {
            provider: "bailian_coding",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 99,
          },
        ],
      },
    ],
  });

  const calls: string[] = [];
  const manager = new EmbeddingManager(
    {
      bailian: {
        async embed(request): Promise<EmbeddingResult> {
          calls.push("bailian");
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            vectors: [{ index: 0, embedding: [0.1, 0.2] }],
          };
        },
      },
      bailian_coding: {
        async embed(request): Promise<EmbeddingResult> {
          calls.push("bailian_coding");
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            vectors: [{ index: 0, embedding: [0.3, 0.4] }],
          };
        },
      },
    },
    undefined,
    {
      commonLlmConfigService: fixture.commonLlmConfigService,
      llmHealthService: fixture.llmHealthService,
      llmMetricsService: fixture.llmMetricsService,
      random: () => 0.5,
      now: () => new Date("2026-03-24T10:20:00+08:00"),
    },
  );

  const result = await manager.embed({
    modelKey: "ainovel-embedding-default",
    modelKeyKind: "scene_route",
    input: ["hello"],
  });

  assert.deepEqual(calls, ["bailian_coding"]);
  assert.equal(result.modelKey, "ainovel-embedding-default");
  assert.equal(result.provider, "bailian_coding");
  assert.equal(result.providerModel, "text-embedding-v4");
  assert.equal(
    (
      await fixture.llmHealthService.getRouteSnapshot({
        modelKey: "text-embedding-v4",
        provider: "bailian_coding",
        providerModel: "text-embedding-v4",
        operation: "embedding",
      })
    ).totalCalls,
    1,
  );
});

test("llm metrics service aggregates the requested window and retention removes old observations", async () => {
  const fixture = await createLlmFixture();
  const config = {
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  };

  const expiredDate = new Date("2025-03-01T09:00:00+08:00");
  const currentDate = new Date("2026-03-24T10:20:00+08:00");

  await recordMetricCall(fixture, {
    modelKey: "kimi2.5",
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
    ok: true,
    firstByteLatencyMs: 120,
    totalLatencyMs: 500,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    occurredAt: expiredDate,
  });

  await recordMetricCall(fixture, {
    modelKey: "kimi2.5",
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
    ok: true,
    firstByteLatencyMs: 200,
    totalLatencyMs: 800,
    usage: {
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
    },
    occurredAt: currentDate,
  });

  await recordMetricCall(fixture, {
    modelKey: "kimi2.5",
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
    ok: false,
    firstByteLatencyMs: 300,
    totalLatencyMs: 900,
    occurredAt: new Date("2026-03-24T10:40:00+08:00"),
  });

  const overview = await fixture.llmMetricsService.getOverview(config, "24h", new Date("2026-03-24T10:50:00+08:00"));
  assert.equal(overview.summary.requestCount, 2);
  assert.equal(overview.summary.successCount, 1);
  assert.equal(overview.summary.failureCount, 1);
  assert.equal(overview.summary.successRate, 50);
  assert.equal(overview.models.items[0]?.summary.avgFirstByteLatencyMs, 250);

  const detail = await fixture.llmMetricsService.getModelDetail(
    config,
    "kimi2.5",
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(detail.routes[0]?.summary.avgTotalLatencyMs, 800);

  await fixture.database.llmObservabilityStore.deleteBefore("2026-03-01T00:00:00.000Z");
  assert.equal(
    fixture.database.llmObservabilityStore.observations.some((item) => item.occurredAt === expiredDate.toISOString()),
    false,
  );
});

test("llm metrics service filters overview and model detail by provider", async () => {
  const fixture = await createLlmFixture();
  const config = {
    enabled: true,
    defaultModelKey: "qwen3.6-plus",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "bailian_coding",
        label: "百炼 Coding Plan",
        enabled: true,
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "mock-coding-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "qwen3.6-plus",
        label: "qwen3.6-plus",
        kind: "chat",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 1,
          },
          {
            provider: "bailian_coding",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 99,
          },
        ],
      },
    ],
  };
  const now = new Date("2026-03-24T10:20:00+08:00");

  await recordMetricCall(fixture, {
    modelKey: "qwen3.6-plus",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
    ok: true,
    firstByteLatencyMs: 100,
    totalLatencyMs: 600,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
    occurredAt: now,
  });
  await recordMetricCall(fixture, {
    modelKey: "qwen3.6-plus",
    provider: "bailian_coding",
    providerModel: "qwen3.6-plus",
    ok: true,
    firstByteLatencyMs: 240,
    totalLatencyMs: 1800,
    usage: {
      promptTokens: 40,
      completionTokens: 20,
      totalTokens: 60,
    },
    occurredAt: now,
  });

  const overview = await fixture.llmMetricsService.getOverview(
    config,
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
    "bailian_coding",
  );

  assert.equal(overview.provider, "bailian_coding");
  assert.deepEqual(overview.providers.map((item) => item.provider), ["bailian", "bailian_coding"]);
  assert.equal(overview.summary.requestCount, 1);
  assert.equal(overview.summary.totalTokens, 60);
  assert.equal(overview.models.items[0]?.modelKey, "qwen3.6-plus");
  assert.equal(overview.models.items[0]?.summary.requestCount, 1);
  assert.equal(overview.models.items[0]?.summary.avgTotalLatencyMs, 1800);

  const detail = await fixture.llmMetricsService.getModelDetail(
    config,
    "qwen3.6-plus",
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
    "bailian_coding",
  );

  assert.equal(detail.provider, "bailian_coding");
  assert.equal(detail.summary.requestCount, 1);
  assert.equal(detail.routes.length, 1);
  assert.equal(detail.routes[0]?.provider, "bailian_coding");
  assert.equal(detail.routes[0]?.summary.totalTokens, 60);
});

test("common llm metrics exclude AINovel scene route keys from model statistics", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "qwen3.6-plus",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "ainovel-free-creative",
        label: "AINovel Free Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "qwen3.6-plus",
        label: "qwen3.6-plus",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  const config = await fixture.commonLlmConfigService.getCurrentConfig();
  assert.equal(config.models.some((item) => item.key === "ainovel-free-creative"), true);

  await recordMetricCall(fixture, {
    modelKey: "qwen3.6-plus",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
    ok: true,
    firstByteLatencyMs: 100,
    totalLatencyMs: 600,
    occurredAt: new Date("2026-03-24T10:20:00+08:00"),
  });

  const overview = await fixture.llmMetricsService.getOverview(
    config,
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(overview.summary.requestCount, 1);
  assert.equal(overview.models.items.some((item) => item.modelKey === "ainovel-free-creative"), false);
  assert.equal(overview.models.items[0]?.modelKey, "qwen3.6-plus");
  assert.equal(overview.models.items[0]?.summary.requestCount, 1);

  const detail = await fixture.llmMetricsService.getModelDetail(
    config,
    "qwen3.6-plus",
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(detail.summary.requestCount, 1);
  assert.equal(detail.routes[0]?.summary.requestCount, 1);
});

test("llm smoke test service returns success/failure/skipped matrix results and enforces cooldown", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "volcengine",
        label: "火山",
        enabled: true,
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "mock-volc-api-key",
        timeoutMs: 30000,
      },
      {
        key: "openai",
        label: "OpenAI",
        enabled: false,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "mock-openai-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        strategy: "auto",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 80,
          },
          {
            provider: "volcengine",
            providerModel: "kimi-2.5",
            enabled: true,
            weight: 20,
          },
          {
            provider: "openai",
            providerModel: "gpt-4.1-mini",
            enabled: false,
            weight: 5,
          },
        ],
      },
    ],
  });

  let now = new Date("2026-03-24T10:00:00+08:00");
  const smokeTestService = new LlmSmokeTestService(
    fixture.commonLlmConfigService,
    fixture.kvManager,
    {
      bailian: createMockProvider("bailian", []),
    },
    {},
    {
      now: () => now,
    },
  );

  const firstRun = await smokeTestService.run();
  assert.equal(firstRun.summary.totalCount, 3);
  assert.equal(firstRun.summary.attemptedCount, 2);
  assert.equal(firstRun.summary.successCount, 1);
  assert.equal(firstRun.summary.failureCount, 1);
  assert.equal(firstRun.summary.skippedCount, 1);
  assert.equal(firstRun.items[0]?.status, "success");
  assert.equal(firstRun.items[1]?.status, "failed");
  assert.equal(firstRun.items[2]?.status, "skipped");
  assert.equal(firstRun.items[0]?.details.request?.provider, "bailian");
  assert.equal(firstRun.items[0]?.details.request?.messages.length, 2);
  assert.equal(firstRun.items[0]?.details.response?.text, "bailian:ok");
  assert.equal(firstRun.items[1]?.details.error?.code, "LLM_ROUTE_NOT_AVAILABLE");
  assert.equal(firstRun.items[1]?.details.request?.providerModel, "kimi-2.5");
  assert.equal(firstRun.items[2]?.details.skip?.providerEnabled, false);
  assert.equal(firstRun.items[2]?.details.skip?.routeEnabled, false);

  await assert.rejects(
    () => smokeTestService.run(),
    (error: Error & { code?: string }) => error.code === "ADMIN_RATE_LIMITED",
  );

  now = new Date("2026-03-24T10:00:11+08:00");
  const secondRun = await smokeTestService.run();
  assert.equal(secondRun.summary.totalCount, 3);
});

test("llm smoke test service runs only the selected model/provider route with a reasoning-safe token limit", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "deepseek-flash",
    providers: [
      {
        key: "openrouter",
        label: "OpenRouter",
        enabled: true,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "mock-openrouter-api-key",
        timeoutMs: 30000,
      },
      {
        key: "bailian",
        label: "百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
      {
        key: "unconfigured",
        label: "Unconfigured",
        enabled: true,
        baseUrl: "https://example.com/v1",
        apiKey: "mock-unconfigured-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "deepseek-flash",
        label: "DeepSeek Flash",
        kind: "chat",
        strategy: "auto",
        routes: [
          {
            provider: "openrouter",
            providerModel: "~deepseek/deepseek-v4-flash-latest",
            enabled: true,
            weight: 50,
          },
          {
            provider: "bailian",
            providerModel: "deepseek-v4-flash",
            enabled: true,
            weight: 50,
          },
        ],
      },
    ],
  });

  const requests: Array<{ provider: string; maxTokens?: number }> = [];
  const smokeTestService = new LlmSmokeTestService(
    fixture.commonLlmConfigService,
    fixture.kvManager,
    {
      openrouter: {
        async complete(request) {
          requests.push({
            provider: request.model.provider,
            maxTokens: request.maxTokens,
          });
          return {
            provider: request.model.provider,
            modelKey: request.model.modelKey,
            providerModel: request.model.providerModel,
            text: "OK",
          };
        },
        async *stream() {
          yield { type: "done" as const };
        },
      },
    },
    {},
    {
      now: () => new Date("2026-08-03T23:30:00+08:00"),
    },
  );

  const run = await smokeTestService.run({
    mode: "route",
    modelKey: "deepseek-flash",
    provider: "openrouter",
  });

  assert.deepEqual(run.target, {
    mode: "route",
    modelKey: "deepseek-flash",
    provider: "openrouter",
  });
  assert.equal(run.summary.totalCount, 1);
  assert.equal(run.summary.successCount, 1);
  assert.equal(run.items[0]?.providerModel, "~deepseek/deepseek-v4-flash-latest");
  assert.equal(run.items[0]?.details.request?.maxTokens, 64);
  assert.deepEqual(requests, [{ provider: "openrouter", maxTokens: 64 }]);

  await assert.rejects(
    () => smokeTestService.run({
      mode: "route",
      modelKey: "deepseek-flash",
      provider: "unconfigured",
    }),
    (error: Error & { code?: string }) => error.code === "ADMIN_LLM_SERVICE_INVALID",
  );
  await assert.rejects(
    () => smokeTestService.run({ mode: "matrix" }),
    (error: Error & { code?: string }) => error.code === "ADMIN_RATE_LIMITED",
  );
});

test("llm smoke test service can exercise qwen3.5-flash through Bailian Coding Plan", async () => {
  const fixture = await createLlmFixture();
  await fixture.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "qwen3.5-flash",
    providers: [
      {
        key: "bailian_coding",
        label: "百炼 Coding Plan",
        enabled: true,
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiKey: "mock-coding-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "qwen3.5-flash",
        label: "Qwen 3.5 Flash",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian_coding",
            providerModel: "qwen3.5-flash",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  const calls: string[] = [];
  const smokeTestService = new LlmSmokeTestService(
    fixture.commonLlmConfigService,
    fixture.kvManager,
    {
      bailian_coding: createMockProvider("bailian_coding", calls),
    },
    {},
    {
      now: () => new Date("2026-03-24T10:30:00+08:00"),
    },
  );

  const run = await smokeTestService.run();

  assert.deepEqual(calls, ["bailian_coding"]);
  assert.equal(run.summary.totalCount, 1);
  assert.equal(run.summary.successCount, 1);
  assert.equal(run.items[0]?.status, "success");
  assert.equal(run.items[0]?.provider, "bailian_coding");
  assert.equal(run.items[0]?.modelKey, "qwen3.5-flash");
  assert.equal(run.items[0]?.providerModel, "qwen3.5-flash");
  assert.equal(run.items[0]?.details.request?.baseUrl, "https://coding.dashscope.aliyuncs.com/v1");
  assert.equal(run.items[0]?.details.response?.provider, "bailian_coding");
  assert.equal(run.items[0]?.details.response?.providerModel, "qwen3.5-flash");
});
