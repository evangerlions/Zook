import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";
import {
  AliyunTokenPlanProvider,
  ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
  DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
} from "../../src/services/aliyun-token-plan-provider.ts";

test("Aliyun Token Plan provider uses its dedicated OpenAI-compatible endpoint", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = new AliyunTokenPlanProvider({
    apiKey: "token-plan-test-key",
    fetchImplementation: async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return new Response(JSON.stringify({
        id: "token-plan-request-1",
        choices: [{
          message: {
            content: "OK",
            reasoning_content: "checked",
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        },
      }));
    },
  });
  const request: ResolvedLLMCompletionRequest = {
    model: {
      provider: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
      modelKey: "tokenplan-qwen3.8-max",
      resolvedModelKey: "tokenplan-qwen3.8-max",
      providerModel: "qwen3.8-max",
    },
    messages: [{ role: "user", content: "Reply with OK." }],
    maxTokens: 16,
  };

  const result = await provider.complete(request);

  assert.equal(
    url,
    `${DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL}/chat/completions`,
  );
  assert.equal(
    (init?.headers as Record<string, string>).Authorization,
    "Bearer token-plan-test-key",
  );
  assert.equal(
    (JSON.parse(String(init?.body)) as Record<string, unknown>).model,
    "qwen3.8-max",
  );
  assert.equal(result.provider, ALIYUN_TOKEN_PLAN_PROVIDER_KEY);
  assert.equal(result.reasoningText, "checked");
  assert.equal(result.providerRequestId, "token-plan-request-1");
});
