import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmRouteCircuitBreakerService } from "../../src/services/llm-route-circuit-breaker.service.ts";
import { LlmRouteCircuitRecoveryService } from "../../src/services/llm-route-circuit-recovery.service.ts";
import { isLlmBalanceFailure } from "../../src/services/llm-balance-failure.ts";
import { throwProviderRequestFailed } from "../../src/services/bailian-openai-compatible-utils.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import { LLMManager } from "../../src/services/llm-manager.ts";

test("OpenRouter ambiguous 402 and all budget/rate-limit variants never use the balance exception", () => {
  for (const errorCode of [402, "402", 429, 403]) {
    for (const metadata of [
      {},
      { limitSource: "openrouter_credits", creditReason: "weight_exceeds_budget" },
      { limitSource: "openrouter_credits", creditReason: "unknown" },
      { limitSource: "openrouter_in_flight_budget", reason: "in_flight_budget_exhausted" },
      { limitSource: "openrouter_key_limit" },
      { limitSource: "unknown_future_limit" },
    ]) {
      const error = new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", "insufficient credits", {
        provider: "openrouter", statusCode: errorCode, errorCode, ...metadata,
      });
      assert.equal(isLlmBalanceFailure("openrouter", error), false, JSON.stringify(error.details));
    }
  }
});

test("only explicit OpenRouter credits source without another reason gets the balance exception", () => {
  for (const reason of [undefined, "weight_exceeds_budget", "in_flight_budget_exhausted", "future_reason", null, 1]) {
    assert.throws(() => throwProviderRequestFailed(402, {
      error: { code: 402, metadata: { limit_source: "openrouter_credits", reason } },
    }, "openrouter"), (error: unknown) => {
      assert.equal(isLlmBalanceFailure("openrouter", error), reason === undefined);
      return true;
    });
  }
});

test("SSE OpenRouter credits metadata survives wrapping, but request-budget reasons are excluded", async () => {
  for (const reason of [undefined, "weight_exceeds_budget", "future_reason"]) {
    const adapter = new OpenRouterOpenAICompatibleProvider({ fetchImplementation: async () => new Response(
      `data: ${JSON.stringify({ error: { code: 402, metadata: { limit_source: "openrouter_credits", reason } } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ) });
    const config = { enabled: true, defaultModelKey: "model",
      openRouter: { useTransparentProxy: false },
      providers: [{ key: "openrouter", enabled: true, apiKey: "test", baseUrl: "https://example.invalid", timeoutMs: 1000 }],
      models: [{ key: "model", kind: "chat", strategy: "fixed", routes: [{ provider: "openrouter", providerModel: "upstream", enabled: true, weight: 100 }] }],
    };
    const manager = new LLMManager({ openrouter: adapter }, {}, { commonLlmConfigService: {
      async getRuntimeConfigSnapshot() { return { config, revision: 1 }; },
    } as never });
    await assert.rejects(async () => { for await (const _ of manager.stream({ modelKey: "model", messages: [{ role: "user", content: "test" }] })) {} }, (error: unknown) => {
      assert.equal(isLlmBalanceFailure("openrouter", error), reason === undefined);
      return true;
    });
  }
});

test("two OpenRouter 402 failures stay closed; four use ordinary confirmation with a second successful probe", async () => {
  const ref = { modelKey: "test-model", provider: "openrouter", providerModel: "upstream/model", operation: "chat" as const };
  const circuit = new LlmRouteCircuitBreakerService(await KVManager.create({ backend: new InMemoryKVBackend() }));
  const error = new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", "insufficient credits", { provider: "openrouter", statusCode: 402, errorCode: 402 });
  for (let i = 0; i < 2; i++) {
    assert.equal(await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "402", isLlmBalanceFailure(ref.provider, error)), undefined);
  }
  assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
  await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "402", false);
  assert.deepEqual(await circuit.recordPreFirstChunkFailure(ref, "same-user", true, "402", false), ref);
  let probes = 0;
  const recovery = new LlmRouteCircuitRecoveryService({ async getRuntimeConfig() {
    return { enabled: true, routeCircuitBreaker: { enabled: true },
      models: [{ key: ref.modelKey, kind: "chat", routes: [{ provider: ref.provider, providerModel: ref.providerModel, enabled: true }] }],
      providers: [{ key: ref.provider, enabled: true }],
    };
  } } as never, circuit, { openrouter: { async complete() {
    probes++;
    if (probes === 1) throw error;
    return { text: "OK" };
  } } } as never);
  await recovery.confirmRoute(ref);
  assert.equal(probes, 2);
  assert.equal((await circuit.getRuntimeStatus(ref, true)).state, "closed");
});
