import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import { CommonLlmConfigService } from "../../src/services/common-llm-config.service.ts";
import type { LLMStreamEvent, ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";

function createRequest(): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "openrouter",
      modelKey: "openrouter-free",
      resolvedModelKey: "openrouter-free",
      providerModel: "openrouter/free",
    },
    messages: [{ role: "user", content: "Reply with OK." }],
    maxTokens: 16,
  };
}

function createSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(event));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

async function collect(stream: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
  const events: LLMStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test("OpenRouter provider uses its endpoint, auth, reasoning, and generation id", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "local";
  let url = "";
  let init: RequestInit | undefined;
  const logger = new StructuredLogger("api", { emitToConsole: false });
  const provider = new OpenRouterOpenAICompatibleProvider({
    apiKey: "openrouter-test-key",
    logger,
    fetchImplementation: async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "OK", reasoning: "brief thought" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), { headers: { "X-Generation-Id": "generation-123" } });
    },
  });

  try {
    const result = await provider.complete(createRequest());

    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer openrouter-test-key");
    assert.equal((JSON.parse(String(init?.body)) as Record<string, unknown>).model, "openrouter/free");
    assert.equal(result.reasoningText, "brief thought");
    assert.equal(result.providerRequestId, "generation-123");
    assert.equal(result.provider, "openrouter");
    assert.equal(
      logger.records.find((record) => record.message === "ai_novel local provider chat request started")?.provider,
      "openrouter",
    );
  } finally {
    if (previousAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousAppEnv;
  }
});

test("OpenRouter provider forwards streaming content, usage, and done", async () => {
  const provider = new OpenRouterOpenAICompatibleProvider({
    apiKey: "openrouter-test-key",
    fetchImplementation: async () => createSseResponse([
      ": OPENROUTER PROCESSING\n\n",
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ]),
  });

  const events = await collect(provider.stream(createRequest()));

  assert.deepEqual(events.map((event) => event.type), ["content_delta", "usage", "done"]);
  assert.equal(events[0]?.type === "content_delta" ? events[0].text : undefined, "OK");
});

test("OpenRouter provider forwards reasoning and tool calls from SSE", async () => {
  const provider = new OpenRouterOpenAICompatibleProvider({
    apiKey: "openrouter-test-key",
    fetchImplementation: async () => createSseResponse([
      'data: {"choices":[{"delta":{"reasoning":"considering"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\\"query\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  });

  const events = await collect(provider.stream(createRequest()));

  assert.equal(events[0]?.type === "reasoning_delta" ? events[0].text : undefined, "considering");
  const toolCallEvent = events.find((event) => event.type === "tool_call");
  assert.deepEqual(toolCallEvent?.type === "tool_call" ? toolCallEvent.toolCall : undefined, {
    id: "call_1",
    name: "lookup",
    input: { query: "x" },
  });
  assert.deepEqual(events.find((event) => event.type === "done"), {
    type: "done",
    finishReason: "tool_calls",
  });
});

test("OpenRouter provider tags upstream failures with the OpenRouter identity", async () => {
  const provider = new OpenRouterOpenAICompatibleProvider({
    apiKey: "openrouter-test-key",
    fetchImplementation: async () => new Response(JSON.stringify({
      error: { message: "invalid credential", code: 401, type: "authentication_error" },
    }), { status: 401 }),
  });

  await assert.rejects(
    () => provider.complete(createRequest()),
    (error: { code?: string; details?: { provider?: string; statusCode?: number } }) =>
      error.code === "LLM_PROVIDER_REQUEST_FAILED" &&
      error.details?.provider === "openrouter" &&
      error.details?.statusCode === 401,
  );
});

test("default LLM config keeps OpenRouter free isolated from AINovel routes", async () => {
  const configService = new CommonLlmConfigService({
    getValue: async () => undefined,
  } as never);

  const config = await configService.getCurrentConfig();

  assert.deepEqual(config.providers.find((item) => item.key === "openrouter"), {
    key: "openrouter",
    label: "OpenRouter",
    enabled: false,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    timeoutMs: 30000,
  });
  assert.deepEqual(config.models.find((item) => item.key === "openrouter-free")?.routes, [{
    provider: "openrouter",
    providerModel: "openrouter/free",
    enabled: true,
    weight: 100,
  }]);
  assert.equal(config.defaultModelKey, "qwen3.6-plus");
});
