import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEEPSEEK_BASE_URL } from "../../src/services/deepseek-provider.ts";
import { createApplication } from "../support/create-test-application.ts";

test("DeepSeek official chat route resolves its password and preserves the A3 request bounds", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), DEFAULT_DEEPSEEK_BASE_URL + "/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-secret");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.max_tokens, 1400);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.enable_thinking, undefined);
    assert.deepEqual(body.response_format, { type: "json_object" });
    return Response.json({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 64, completion_tokens: 5, total_tokens: 69 },
    });
  };
  let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    runtime = await createApplication();
    await runtime.services.commonPasswordConfigService.set("deepseek.fixture", "DeepSeek test", "fixture-secret");
    await runtime.services.commonLlmConfigService.updateConfig({
      enabled: true,
      defaultModelKey: "deepseek-v4-flash",
      providers: [{
        key: "deepseek_a3", type: "deepseek", enabled: true,
        label: "DeepSeek", baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
        apiKey: "{{zook.ps.deepseek.fixture}}", timeoutMs: 30000,
      }],
      models: [{
        key: "deepseek-v4-flash", kind: "chat", label: "DeepSeek Flash", strategy: "fixed",
        routes: [{ provider: "deepseek_a3", providerModel: "deepseek-flash", weight: 100, enabled: true }],
      }],
    });
    const result = await runtime.services.llmManager.complete({
      modelKey: "deepseek-v4-flash",
      messages: [{ role: "user", content: "Return a JSON object." }],
      maxTokens: 1400,
      providerOptions: { enable_thinking: false, response_format: { type: "json_object" } },
    });
    assert.equal(result.provider, "deepseek_a3");
    assert.equal(result.providerModel, "deepseek-flash");
    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.usage?.totalTokens, 69);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime?.close();
  }
});
