import assert from "node:assert/strict";
import test from "node:test";
import { VolcengineProvider, DEFAULT_VOLCENGINE_BASE_URL } from "../../src/services/volcengine-provider.ts";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";
import { createApplication } from "../support/create-test-application.ts";

const request: ResolvedLLMCompletionRequest = {
  model: { provider: "volcengine", modelKey: "doubao-seed-2.1-pro",
    resolvedModelKey: "doubao-seed-2.1-pro", providerModel: "ep-test" },
  messages: [{ role: "user", content: "Hello" }],
  providerOptions: { enable_thinking: false }, maxTokens: 128,
};
const reply = { id: "ark-1", choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51,
    prompt_tokens_details: { cached_tokens: 10 } } };

test("Ark pay-as-you-go uses endpoint id and maps thinking without mutating caller", async () => {
  const provider = new VolcengineProvider({ apiKey: "test-key", fetchImplementation: async (url, init) => {
    assert.equal(String(url), DEFAULT_VOLCENGINE_BASE_URL + "/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "ep-test");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.enable_thinking, undefined);
    return Response.json(reply);
  } });
  const result = await provider.complete(request);
  assert.equal(result.provider, "volcengine");
  assert.equal(result.text, "OK");
  assert.equal(result.usage?.cachedInputTokens, 10);
  assert.deepEqual(request.providerOptions, { enable_thinking: false });
});

test("Ark stream retains explicit thinking, tool calls, usage and completion", async () => {
  const provider = new VolcengineProvider({ apiKey: "test-key", fetchImplementation: async (_, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, true);
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function",
        function: { name: "read_meta", arguments: "{}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: reply.usage },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
  } });
  const events = [];
  for await (const event of provider.stream({ ...request, providerOptions: {
    enable_thinking: true, thinking: { type: "disabled" },
  } })) events.push(event);
  assert.ok(events.some(e => e.type === "tool_call" && e.toolCall.name === "read_meta"));
  assert.ok(events.some(e => e.type === "usage" && e.usage.totalTokens === 51));
  assert.equal(events.at(-1)?.type, "done");
});

test("default application registers Ark and resolves Password through normal routing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), DEFAULT_VOLCENGINE_BASE_URL + "/chat/completions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture-secret");
    assert.equal(JSON.parse(String(init?.body)).model, "ep-fixture");
    return Response.json(reply);
  };
  const runtime = await createApplication();
  try {
    await runtime.services.commonPasswordConfigService.set("vol.api_key", "Ark test", "fixture-secret");
    await runtime.services.commonLlmConfigService.updateConfig({ enabled: true, defaultModelKey: "doubao-seed-2.1-pro",
      providers: [{ key: "volcengine", label: "Volcengine Ark", enabled: true,
        baseUrl: DEFAULT_VOLCENGINE_BASE_URL, apiKey: "{{zook.ps.vol.api_key}}", timeoutMs: 30000 }],
      models: [{ key: "doubao-seed-2.1-pro", label: "Doubao Seed 2.1 Pro", kind: "chat", strategy: "fixed",
        routes: [{ provider: "volcengine", providerModel: "ep-fixture", enabled: true, weight: 100 }] }],
    });
    const result = await runtime.services.llmManager.complete({ modelKey: "doubao-seed-2.1-pro", messages: request.messages });
    assert.equal(result.provider, "volcengine");
    assert.equal(result.text, "OK");
    assert.equal(result.usage?.totalTokens, 51);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
  }
});
