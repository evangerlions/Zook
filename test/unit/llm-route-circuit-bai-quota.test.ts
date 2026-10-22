import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { LlmRouteCircuitBreakerService } from "../../src/services/llm-route-circuit-breaker.service.ts";
import { LlmRouteCircuitRecoveryService } from "../../src/services/llm-route-circuit-recovery.service.ts";
import { BaiOpenAICompatibleProvider } from "../../src/services/bai-openai-compatible-provider.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import { isLlmBalanceFailure } from "../../src/services/llm-balance-failure.ts";
import { llmErrorDiagnosticCode } from "../../src/services/llm-error-diagnostic-code.ts";
import { LLMManager } from "../../src/services/llm-manager.ts";

const quota = "insufficient_user_quota";
const route = { modelKey: "deepseek-v4-flash", provider: "bai", providerModel: "deepseek-v4.1-flash", operation: "chat" as const };
const balanceError = (provider: string) => new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", "insufficient credits", {
  provider, statusCode: provider === "bai" ? 400 : 402, errorCode: provider === "bai" ? quota : 402,
  ...(provider === "openrouter" ? { limitSource: "openrouter_credits" } : {}),
});

async function fixture(provider = "bai") {
  let now = new Date("2030-01-01T00:00:00Z");
  const ref = { ...route, provider };
  const circuit = new LlmRouteCircuitBreakerService(await KVManager.create({ backend: new InMemoryKVBackend() }), { now: () => now });
  const config = {
    enabled: true, defaultModelKey: ref.modelKey,
    openRouter: { useTransparentProxy: false, transparentProxyBaseUrl: "", transparentProxyKeyId: "", transparentProxyHmacSecretKey: "" },
    bai: { useTransparentProxy: false, transparentProxyBaseUrl: "", transparentProxyKeyId: "", transparentProxyHmacSecretKey: "" },
    routeCircuitBreaker: { enabled: true },
    providers: [{ key: provider, label: provider, enabled: true, baseUrl: "https://example.invalid/v1", apiKey: "test", timeoutMs: 1000 }],
    models: [{ key: ref.modelKey, label: ref.modelKey, kind: "chat", strategy: "auto", routes: [{ provider, providerModel: ref.providerModel, enabled: true, weight: 100 }] }],
  };
  const configService = { async getRuntimeConfig() { return config; }, async getRuntimeConfigSnapshot() { return { config, revision: 1 }; } } as never;
  return { circuit, ref, configService, at: (time: string) => { now = new Date(time); } };
}

for (const provider of ["bai", "openrouter"]) {
  test(`${provider}: two balance failures start confirmation, not immediate isolation`, async () => {
    const { circuit, ref } = await fixture(provider);
    assert.equal(await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "balance", true), undefined);
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
    assert.deepEqual(await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "balance", true), ref);
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "confirming");
  });

  test(`${provider}: one balance probe opens circuit without a second probe; recovery remains automatic`, async () => {
    const { circuit, ref, configService, at } = await fixture(provider);
    for (let i = 0; i < 2; i++) await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "balance", true);
    let probes = 0;
    const recovery = new LlmRouteCircuitRecoveryService(configService, circuit, { [provider]: {
      async complete() { probes++; if (probes === 1) throw balanceError(provider); return { text: "OK" }; },
    } } as never);
    await recovery.confirmRoute(ref);
    assert.equal(probes, 1);
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "open");
    assert.ok((await circuit.getRuntimeStatus(ref, true)).nextRecoveryAt);
    at("2030-01-01T01:00:00Z");
    assert.deepEqual(await recovery.runDueRecoveries(), { attempted: 1, restored: 1, failed: 0 });
    assert.equal(probes, 3);
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
  });

  test(`${provider}: real adapter payload reaches manager and triggers only the second request`, async () => {
    const { circuit, ref, configService } = await fixture(provider);
    let calls = 0, confirmations = 0;
    const Adapter = provider === "bai" ? BaiOpenAICompatibleProvider : OpenRouterOpenAICompatibleProvider;
    const adapter = new Adapter({ fetchImplementation: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: provider === "bai" ? quota : 402, message: "insufficient credits",
        ...(provider === "openrouter" ? { metadata: { limit_source: "openrouter_credits" } } : {}),
      } }), { status: provider === "bai" ? 400 : 402 });
    } });
    const manager = new LLMManager({ [provider]: adapter }, {}, {
      llmRouteCircuitBreaker: circuit, onLlmRouteCircuitConfirmation: () => { confirmations++; }, commonLlmConfigService: configService,
    });
    const call = async () => { for await (const _ of manager.stream({ modelKey: ref.modelKey, messages: [{ role: "user", content: "hello" }], usageOwner: { appId: "app", userId: "same-user" } })) {} };
    await assert.rejects(call, { code: "LLM_PROVIDER_REQUEST_FAILED" });
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
    await assert.rejects(call, { code: "LLM_PROVIDER_REQUEST_FAILED" });
    assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "confirming");
    assert.equal(calls, 2);
    assert.equal(confirmations, 1);
  });
}

test("balance window expires at exactly 24h and first effective chunk resets balance counts", async () => {
  const { circuit, ref, at } = await fixture();
  await circuit.recordPreFirstChunkFailure(ref, "user", true, quota, true);
  at("2030-01-02T00:00:00Z");
  assert.equal(await circuit.recordPreFirstChunkFailure(ref, "user", true, quota, true), undefined);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).failureCount, 1);
  await circuit.recordFirstEffectiveChunk(ref, true);
  assert.equal(await circuit.recordPreFirstChunkFailure(ref, "user", true, quota, true), undefined);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).failureCount, 1);
});

test("generic probe failure retries once and success clears confirmation", async () => {
  const { circuit, ref, configService } = await fixture();
  for (let i = 0; i < 4; i++) await circuit.recordPreFirstChunkFailure(ref, "user", true, "timeout");
  let probes = 0;
  const recovery = new LlmRouteCircuitRecoveryService(configService, circuit, { bai: {
    async complete() { probes++; if (probes === 1) throw new Error("timeout"); return { text: "OK" }; },
  } } as never);
  await recovery.confirmRoute(ref);
  assert.equal(probes, 2);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
});

test("concurrent balance failures dispatch only one confirmation and disabled circuits do not count", async () => {
  const { circuit, ref } = await fixture();
  await circuit.recordPreFirstChunkFailure(ref, "user", false, quota, true);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).failureCount, 0);
  const results = await Promise.all(Array.from({ length: 8 }, () => circuit.recordPreFirstChunkFailure(ref, "user", true, quota, true)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).failureCount, 2);
  await circuit.recoverDueRoutes(false, async () => true);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
});

test("OpenRouter HTTP 200 SSE 402 is diagnostic only, not proof of balance exhaustion", async () => {
  const { ref, configService } = await fixture("openrouter");
  const adapter = new OpenRouterOpenAICompatibleProvider({ fetchImplementation: async () => new Response(
    'data: {"error":{"code":402,"message":"insufficient credits"}}\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } },
  ) });
  const manager = new LLMManager({ openrouter: adapter }, {}, { commonLlmConfigService: configService });
  await assert.rejects(async () => { for await (const _ of manager.stream({ modelKey: ref.modelKey, messages: [{ role: "user", content: "test" }] })) {} }, (error: unknown) => {
    assert.equal(isLlmBalanceFailure("openrouter", error), false);
    assert.equal(llmErrorDiagnosticCode(error), "402");
    return true;
  });
});

test("classification excludes wrong provider, generic errors and OpenRouter in-flight budget", async () => {
  assert.equal(isLlmBalanceFailure("bai", balanceError("bai")), true);
  assert.equal(isLlmBalanceFailure("openrouter", balanceError("openrouter")), true);
  assert.equal(llmErrorDiagnosticCode(balanceError("openrouter")), "402");
  assert.equal(isLlmBalanceFailure("bailian", balanceError("bai")), false);
  assert.equal(isLlmBalanceFailure("bai", new Error("insufficient_user_quota")), false);
  for (const code of [400, 429, "rate_limit_exceeded", "invalid_api_key"]) {
    assert.equal(isLlmBalanceFailure("bai", new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", "quota", { provider: "bai", errorCode: code })), false);
  }
  const { ref, configService } = await fixture("openrouter");
  const adapter = new OpenRouterOpenAICompatibleProvider({ fetchImplementation: async () => new Response(JSON.stringify({
    error: { code: 402, message: "budget", metadata: { limit_source: "openrouter_in_flight_budget", sensitive: "do not copy" } },
  }), { status: 402 }) });
  const manager = new LLMManager({ openrouter: adapter }, {}, { commonLlmConfigService: configService });
  await assert.rejects(async () => { for await (const _ of manager.stream({ modelKey: ref.modelKey, messages: [{ role: "user", content: "test" }] })) {} }, (error: unknown) => {
    assert.equal(isLlmBalanceFailure("openrouter", error), false);
    assert.equal(JSON.stringify((error as ApplicationError).details).includes("do not copy"), false);
    return true;
  });
});
