import assert from "node:assert/strict";
import test from "node:test";
import { BailianOpenAICompatibleProvider } from "../../src/services/bailian-openai-compatible-provider.ts";
import type { ResolvedEmbeddingRequest } from "../../src/services/embedding-manager.ts";
import type { LLMStreamEvent, ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";

function createResolvedRequest(providerOptions?: Record<string, unknown>): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "bailian",
      modelKey: "kimi2.5",
      providerModel: "kimi/kimi-k2.5",
    },
    messages: [
      {
        role: "system",
        content: "You are helpful.",
      },
      {
        role: "user",
        content: "hello",
      },
    ],
    temperature: 0.2,
    maxTokens: 128,
    providerOptions,
  };
}

function createResolvedEmbeddingRequest(providerOptions?: Record<string, unknown>): ResolvedEmbeddingRequest {
  return {
    model: {
      provider: "bailian",
      modelKey: "novel-embedding",
      providerModel: "text-embedding-v4",
    },
    input: ["hello world"],
    providerOptions,
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

async function collectEvents(stream: AsyncIterable<LLMStreamEvent>): Promise<LLMStreamEvent[]> {
  const events: LLMStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

test("bailian provider sends the expected completion request and parses the response", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const provider = new BailianOpenAICompatibleProvider({
    apiKey: "mock-bailian-key",
    fetchImplementation: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return createJsonResponse({
        id: "chatcmpl-test-id",
        choices: [
          {
            message: {
              content: "2",
              reasoning_content: "basic arithmetic",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      });
    },
  });

  const result = await provider.complete(
    createResolvedRequest({
      enable_thinking: true,
    }),
  );

  assert.equal(capturedUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer mock-bailian-key");
  const parsedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(parsedBody.model, "kimi/kimi-k2.5");
  assert.equal(parsedBody.enable_thinking, true);
  assert.equal(parsedBody.temperature, 0.2);
  assert.equal(parsedBody.max_tokens, 128);
  assert.deepEqual(parsedBody.messages, createResolvedRequest().messages);

  assert.equal(result.text, "2");
  assert.equal(result.reasoningText, "basic arithmetic");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.providerRequestId, "chatcmpl-test-id");
  assert.deepEqual(result.usage, {
    promptTokens: 12,
    completionTokens: 4,
    totalTokens: 16,
  });
});

test("bailian provider parses reasoning, content, usage and done events from SSE", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createSseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"step 1"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
        "data: [DONE]\n\n",
      ]),
  });

  const events = await collectEvents(provider.stream(createResolvedRequest({
    enable_thinking: true,
  })));

  assert.deepEqual(events, [
    { type: "reasoning_delta", text: "step 1" },
    { type: "content_delta", text: "Hello" },
    { type: "content_delta", text: " world" },
    {
      type: "usage",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    },
    { type: "done", finishReason: "stop" },
  ]);
});

test("bailian provider turns HTTP failures into provider request errors", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createJsonResponse(
        {
          error: {
            message: "upstream failed",
            code: "BadRequest",
          },
        },
        400,
      ),
  });

  await assert.rejects(
    async () => provider.complete(createResolvedRequest()),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_REQUEST_FAILED",
  );
});

test("bailian provider sends the expected embedding request and parses the response", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const provider = new BailianOpenAICompatibleProvider({
    apiKey: "mock-bailian-key",
    fetchImplementation: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return createJsonResponse({
        id: "embd-test-id",
        data: [
          {
            index: 0,
            embedding: [0.12, -0.03, 0.44],
          },
        ],
        usage: {
          prompt_tokens: 8,
          total_tokens: 8,
        },
      });
    },
  });

  const result = await provider.embed(createResolvedEmbeddingRequest({
    encoding_format: "float",
  }));

  assert.equal(capturedUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer mock-bailian-key");
  const parsedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(parsedBody.model, "text-embedding-v4");
  assert.equal(parsedBody.encoding_format, "float");
  assert.deepEqual(parsedBody.input, ["hello world"]);
  assert.equal(result.providerRequestId, "embd-test-id");
  assert.equal(result.vectors.length, 1);
  assert.deepEqual(result.usage, {
    promptTokens: 8,
    completionTokens: 0,
    totalTokens: 8,
  });
});

test("bailian provider rejects invalid SSE chunks", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createSseResponse([
        "data: not-json\n\n",
        "data: [DONE]\n\n",
      ]),
  });

  await assert.rejects(
    async () => collectEvents(provider.stream(createResolvedRequest())),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_RESPONSE_INVALID",
  );
});
