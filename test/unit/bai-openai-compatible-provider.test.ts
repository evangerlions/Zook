import assert from "node:assert/strict";
import test from "node:test";
import { BaiOpenAICompatibleProvider } from "../../src/services/bai-openai-compatible-provider.ts";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";

function createRequest(
  providerOptions?: Record<string, unknown>,
): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "bai",
      modelKey: "bai-glm-5.3-flash",
      resolvedModelKey: "bai-glm-5.3-flash",
      providerModel: "glm-5.3-flash",
    },
    messages: [{ role: "user", content: "Reply with OK." }],
    maxTokens: 256,
    providerOptions,
  };
}

test("B.AI provider uses the B.AI endpoint and gives GLM visible-output reasoning headroom", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = new BaiOpenAICompatibleProvider({
    apiKey: "bai-test-key",
    fetchImplementation: async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }));
    },
  });

  const result = await provider.complete(createRequest());

  assert.equal(url, "https://api.b.ai/v1/chat/completions");
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer bai-test-key");
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "glm-5.3-flash");
  assert.equal(body.reasoning_effort, "low");
  assert.equal(result.provider, "bai");
});

test("B.AI provider preserves an explicit reasoning effort", async () => {
  let init: RequestInit | undefined;
  const provider = new BaiOpenAICompatibleProvider({
    apiKey: "bai-test-key",
    fetchImplementation: async (_input, requestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    },
  });

  await provider.complete(createRequest({ reasoning_effort: "high" }));

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.reasoning_effort, "high");
});
