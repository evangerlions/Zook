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
    temperature: 0.55,
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
  assert.equal(JSON.parse(String(init?.body)).temperature, 0.55);
});

test("Volcengine Agent Plan sends temperature 1 to Kimi K3.1 Pro for probes and streams", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const provider = new VolcengineAgentPlanProvider({
    apiKey: "volcengine-test-key",
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      if (body.stream) {
        return new Response(
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    },
  });
  const request: ResolvedLLMCompletionRequest = {
    model: {
      provider: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      modelKey: "kimi-k3.1-pro",
      resolvedModelKey: "kimi-k3.1-pro",
      providerModel: "kimi-k3.1-pro",
    },
    messages: [{ role: "user", content: "Reply with OK." }],
  };

  await provider.complete({ ...request, temperature: 0 });
  for await (const _event of provider.stream({ ...request, temperature: 0.55 })) {
    // Drain the stream so the test exercises the real HTTP request builder.
  }

  assert.deepEqual(sent.map(({ temperature, stream }) => ({ temperature, stream })), [
    { temperature: 1, stream: undefined },
    { temperature: 1, stream: true },
  ]);
});
