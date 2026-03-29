import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/infrastructure/database/prisma/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { AppConfigService } from "../../src/services/app-config.service.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { LlmHealthService } from "../../src/services/llm-health.service.ts";
import { LLMManager, type LLMCompletionResult, type LLMProvider, type LLMStreamEvent } from "../../src/services/llm-manager.ts";
import { LlmMetricsService } from "../../src/services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "../../src/services/llm-smoke-test.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";
import { toHourKey } from "../../src/shared/utils.ts";

async function createLlmFixture() {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const database = new InMemoryDatabase();
  const cache = new InMemoryCache();
  const appConfigService = new AppConfigService(database, cache, kvManager);
  const passwordManager = new PasswordManager(kvManager);
  const commonPasswordConfigService = new CommonPasswordConfigService(passwordManager);
  const secretReferenceResolver = new SecretReferenceResolver(commonPasswordConfigService);
  const commonLlmConfigService = new CommonLlmConfigService(appConfigService, secretReferenceResolver);
  const llmHealthService = new LlmHealthService(kvManager);
  const llmMetricsService = new LlmMetricsService(kvManager);

  return {
    kvManager,
    commonPasswordConfigService,
    commonLlmConfigService,
    llmHealthService,
    llmMetricsService,
  };
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
    await fixture.llmHealthService.recordResult(
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

  await fixture.llmHealthService.recordResult(
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
    await fixture.llmHealthService.recordResult(
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

test("llm metrics service aggregates hourly data and prunes buckets older than one year", async () => {
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

  await fixture.llmMetricsService.recordCall({
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

  await fixture.llmMetricsService.recordCall({
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

  await fixture.llmMetricsService.recordCall({
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
  assert.equal(overview.models[0]?.summary.avgFirstByteLatencyMs, 250);

  const detail = await fixture.llmMetricsService.getModelDetail(
    config,
    "kimi2.5",
    "24h",
    new Date("2026-03-24T10:50:00+08:00"),
  );
  assert.equal(detail.routes[0]?.summary.avgTotalLatencyMs, 850);

  const expiredBucket = await fixture.kvManager.getJson("llm-metrics:global", toHourKey(expiredDate));
  assert.equal(expiredBucket, undefined);
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
