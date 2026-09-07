import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";
import {
  DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
  VolcengineAgentPlanProvider,
  VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
} from "../../src/services/volcengine-agent-plan-provider.ts";

test("Volcengine Agent Plan provider uses its chat endpoint and caller config", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const provider = new VolcengineAgentPlanProvider({
    apiKey: "volcengine-test-key",
    fetchImplementation: async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return new Response(JSON.stringify({
        id: "ark-request-1",
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
      provider: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      modelKey: "doubao-seed-2.0-pro",
      resolvedModelKey: "doubao-seed-2.0-pro",
      providerModel: "doubao-seed-2.0-pro",
    },
    messages: [{ role: "user", content: "Reply with OK." }],
    maxTokens: 16,
  };

  const result = await provider.complete(request);

  assert.equal(
    url,
    `${DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL}/chat/completions`,
  );
  assert.equal(
    (init?.headers as Record<string, string>).Authorization,
    "Bearer volcengine-test-key",
  );
  assert.equal(
    (JSON.parse(String(init?.body)) as Record<string, unknown>).model,
    "doubao-seed-2.0-pro",
  );
  assert.equal(result.provider, VOLCENGINE_AGENT_PLAN_PROVIDER_KEY);
  assert.equal(result.reasoningText, "checked");
  assert.equal(result.providerRequestId, "ark-request-1");
});
