import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";
import { buildLlmSmokeChatRequest } from "../../src/services/llm-smoke-test.service.ts";

function createRequest(providerModel = "deepseek/deepseek-v4-flash"): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "openrouter",
      modelKey: "deepseek-v4-flash",
      resolvedModelKey: "deepseek-v4-flash",
      providerModel,
      openRouter: { provider: { order: ["deepinfra", "gmicloud", "siliconflow"], allow_fallbacks: true } },
    },
    messages: [{ role: "user", content: "OK" }],
    maxTokens: 32768,
    providerOptions: {
      enable_thinking: true,
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
      tool_choice: "auto",
    },
  };
}

for (const mode of ["complete", "stream"] as const) {
  async function captureBody(request: ResolvedLLMCompletionRequest) {
    let body: Record<string, unknown> = {};
    const provider = new OpenRouterOpenAICompatibleProvider({
      apiKey: "test-key",
      fetchImplementation: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        if (mode === "stream") {
          return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }));
      },
    });
    if (mode === "complete") await provider.complete(request);
    else for await (const _event of provider.stream(request)) { /* consume */ }
    return body;
  }

  test(`OpenRouter ${mode} prefers stable Flash providers with unrestricted fallbacks`, async () => {
    const request = createRequest();
    const before = structuredClone(request);
    const body = await captureBody(request);
    assert.deepEqual(body.provider, {
      order: ["deepinfra", "gmicloud", "siliconflow"],
      allow_fallbacks: true,
    });
    assert.deepEqual(body.tools, request.providerOptions?.tools);
    assert.equal(body.tool_choice, "auto");
    assert.equal(body.enable_thinking, true);
    assert.equal(body.max_tokens, 32768);
    assert.equal(body.model, request.model.providerModel);
    assert.deepEqual(request, before);
  });

  test(`OpenRouter ${mode} makes saved route policy authoritative, including an empty policy`, async () => {
    for (const policy of [{}, { order: ["gmicloud"], allow_fallbacks: false }]) {
      const request = createRequest();
      request.model.openRouter = { provider: policy };
      request.providerOptions = { ...request.providerOptions, provider: { order: ["relace"] } };
      const body = await captureBody(request);
      assert.deepEqual(body.provider, policy);
    }
  });

  test(`OpenRouter ${mode} applies routing to the shared smoke and circuit probe request`, async () => {
    const route = {
      provider: "openrouter", providerModel: "deepseek/deepseek-v4-flash", enabled: true, weight: 100,
      openRouter: { provider: { order: ["deepinfra", "gmicloud", "siliconflow"], allow_fallbacks: true } },
    };
    const request = buildLlmSmokeChatRequest({
      provider: {
        key: "openrouter", label: "OpenRouter", enabled: true,
        baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key", timeoutMs: 30000,
      },
      model: { key: "deepseek-v4-flash", label: "Flash", kind: "chat", strategy: "fixed", routes: [route] },
      route,
    });
    const body = await captureBody(request);
    assert.deepEqual(body.provider, {
      order: ["deepinfra", "gmicloud", "siliconflow"], allow_fallbacks: true,
    });
    assert.equal(body.max_tokens, 64);
    assert.deepEqual(request.providerOptions, {});
  });

  test(`OpenRouter ${mode} does not inject a hardcoded policy without route config`, async () => {
    for (const model of ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "openrouter/free"]) {
      const request = createRequest(model);
      delete request.model.openRouter;
      const body = await captureBody(request);
      assert.equal(body.provider, undefined);
    }
  });
}
