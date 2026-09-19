import assert from "node:assert/strict";
import test from "node:test";
import { BaiOpenAICompatibleProvider } from "../../src/services/bai-openai-compatible-provider.ts";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";

function createRequest(
  providerOptions?: Record<string, unknown>,
  providerModel = "glm-5.3-flash",
): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "bai",
      modelKey: "bai-glm-5.3-flash",
      resolvedModelKey: "bai-glm-5.3-flash",
      providerModel,
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

test("B.AI provider splits reasoning for MiniMax M3 by default", async () => {
  let init: RequestInit | undefined;
  const provider = new BaiOpenAICompatibleProvider({
    apiKey: "bai-test-key",
    fetchImplementation: async (_input, requestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    },
  });

  await provider.complete(createRequest(undefined, "minimax-m3"));

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.reasoning_split, true);
});

test("B.AI provider preserves an explicit MiniMax reasoning split setting", async () => {
  let init: RequestInit | undefined;
  const provider = new BaiOpenAICompatibleProvider({
    apiKey: "bai-test-key",
    fetchImplementation: async (_input, requestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    },
  });

  await provider.complete(createRequest({ reasoning_split: false }, "minimax-m3"));

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.reasoning_split, false);
});

test("B.AI provider applies MiniMax reasoning split to streamed requests", async () => {
  let init: RequestInit | undefined;
  const provider = new BaiOpenAICompatibleProvider({
    apiKey: "bai-test-key",
    fetchImplementation: async (_input, requestInit) => {
      init = requestInit;
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });

  for await (const _event of provider.stream(createRequest(undefined, "minimax-m3"))) {
    // Consume the stream so the provider sends the request and finalizes it.
  }

  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.equal(body.reasoning_split, true);
});
