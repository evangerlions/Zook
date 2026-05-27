import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
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

test("bailian provider parses non-streaming completion tool calls", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createJsonResponse({
        id: "chatcmpl-tool-id",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "tool-call-1",
                  type: "function",
                  function: {
                    name: "submit_chapter_summary",
                    arguments:
                      '{"summary":"雨夜事故引出调查线索","facts":{"actualEvents":["事故"]}}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
  });

  const result = await provider.complete(createResolvedRequest());

  assert.equal(result.text, "");
  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.providerRequestId, "chatcmpl-tool-id");
  assert.deepEqual(result.toolCalls, [
    {
      id: "tool-call-1",
      name: "submit_chapter_summary",
      input: {
        summary: "雨夜事故引出调查线索",
        facts: {
          actualEvents: ["事故"],
        },
      },
    },
  ]);
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
    {
      type: "reasoning_delta",
      text: "step 1",
      rawEvent: '{"choices":[{"delta":{"reasoning_content":"step 1"},"finish_reason":null}]}',
    },
    {
      type: "content_delta",
      text: "Hello",
      rawEvent: '{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    },
    {
      type: "content_delta",
      text: " world",
      rawEvent: '{"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}',
    },
    {
      type: "usage",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      rawEvent: '{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
    },
    { type: "done", finishReason: "stop" },
  ]);
});

test("bailian provider does not abort an active stream by total request timeout", async () => {
  const encoder = new TextEncoder();
  let capturedSignal: AbortSignal | undefined;
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            capturedSignal?.addEventListener("abort", () => {
              controller.error(capturedSignal?.reason ?? new Error("aborted"));
            });
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"slow"},"finish_reason":null}]}\n\n',
              ),
            );
            setTimeout(() => {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":" stream"},"finish_reason":"stop"}]}\n\n',
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            }, 30);
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
          },
        },
      );
    },
  });

  const request = createResolvedRequest();
  request.model.providerConfig = {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "mock-bailian-key",
    timeoutMs: 10,
  };

  const events = await collectEvents(provider.stream(request));

  assert.ok(capturedSignal);
  assert.equal(capturedSignal.aborted, false);
  assert.deepEqual(events.map((event) => event.type), [
    "content_delta",
    "content_delta",
    "done",
  ]);
});

test("bailian provider does not use provider timeout as streamed generation timeout before headers", async () => {
  const encoder = new TextEncoder();
  let capturedSignal: AbortSignal | undefined;
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"write_draft","arguments":"{\\"content\\":\\"slow draft\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
    },
  });

  const request = createResolvedRequest();
  request.model.providerConfig = {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "mock-bailian-key",
    timeoutMs: 10,
  };

  const events = await collectEvents(provider.stream(request));

  assert.ok(capturedSignal);
  assert.equal(capturedSignal.aborted, false);
  assert.deepEqual(events, [
    {
      type: "tool_call",
      toolCall: {
        id: "kimi2.5_tool_0",
        name: "write_draft",
        input: {
          content: "slow draft",
        },
      },
      rawEvent:
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"write_draft","arguments":"{\\"content\\":\\"slow draft\\"}"}}]},"finish_reason":"tool_calls"}]}',
    },
    { type: "done", finishReason: "tool_calls" },
  ]);
});

test("bailian provider aborts streams that do not return headers before first-event timeout", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async (_input, init) => {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(resolve, 50);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        });
      });
      return createSseResponse(["data: [DONE]\n\n"]);
    },
  });

  await assert.rejects(
    async () =>
      collectEvents(provider.stream(createResolvedRequest({
        stream_options: {
          first_event_timeout_ms: 5,
        },
      }))),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_REQUEST_FAILED",
  );
});

test("bailian provider treats blank streamed tool call ids as missing", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createSseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","function":{"name":"read_draft","arguments":"{\\"limit\\":100}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
  });

  const events = await collectEvents(provider.stream(createResolvedRequest()));

  assert.deepEqual(events, [
    {
      type: "tool_call",
      toolCall: {
        id: "kimi2.5_tool_0",
        name: "read_draft",
        input: {
          limit: 100,
        },
      },
      rawEvent:
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","function":{"name":"read_draft","arguments":"{\\"limit\\":100}"}}]},"finish_reason":"tool_calls"}]}',
    },
    { type: "done", finishReason: "tool_calls" },
  ]);
});

test("bailian provider does not overwrite a valid streamed tool call id with a later blank id", async () => {
  const provider = new BailianOpenAICompatibleProvider({
    fetchImplementation: async () =>
      createSseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-valid","function":{"name":"read_draft","arguments":"{\\"limit\\""}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"   ","function":{"arguments":":100}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
  });

  const events = await collectEvents(provider.stream(createResolvedRequest()));
  const toolCallEvent = events.find((event) => event.type === "tool_call");

  assert.ok(toolCallEvent);
  assert.equal(toolCallEvent.toolCall.id, "tool-valid");
  assert.deepEqual(toolCallEvent.toolCall.input, { limit: 100 });
});

test("bailian provider logs local provider request body and raw stream chunk", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "local";
  const logger = new StructuredLogger("api", { emitToConsole: false });

  try {
    const provider = new BailianOpenAICompatibleProvider({
      logger,
      fetchImplementation: async () =>
        createSseResponse([
          'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          "data: [DONE]\n\n",
        ]),
    });

    await collectEvents(provider.stream(createResolvedRequest({
      enable_thinking: true,
      tools: [
        {
          type: "function",
          function: {
            name: "ask_question",
            description: "Ask one focused kickoff question.",
            parameters: {
              type: "object",
              properties: {
                question: { type: "string" },
              },
            },
          },
        },
      ],
    })));

    const requestLog = logger.records.find((entry) =>
      entry.message === "ai_novel local provider chat request body"
    );
    assert.ok(requestLog);
    assert.equal(requestLog.mode, "stream");
    assert.match(String(requestLog.url ?? ""), /chat\/completions$/);
    assert.equal((requestLog.body as Record<string, unknown>).model, "kimi/kimi-k2.5");

    const chunkLog = logger.records.find((entry) =>
      entry.message === "ai_novel local provider raw stream chunk"
    );
    assert.ok(chunkLog);
    assert.equal(chunkLog.modelKey, "kimi2.5");
    assert.equal(
      chunkLog.chunk,
      '{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    );
  } finally {
    process.env.APP_ENV = previousAppEnv;
  }
});

test("bailian provider redacts local provider request body when requested", async () => {
  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "local";
  const logger = new StructuredLogger("api", { emitToConsole: false });
  let capturedInit: RequestInit | undefined;

  try {
    const provider = new BailianOpenAICompatibleProvider({
      logger,
      fetchImplementation: async (_input, init) => {
        capturedInit = init;
        return createJsonResponse({
          id: "chatcmpl-redacted-log",
          choices: [
            {
              message: {
                content: '{"decision":"pass","category":"safe"}',
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    await provider.complete({
      ...createResolvedRequest({
        enable_thinking: false,
        zookLogBodyMode: "redacted",
      }),
      messages: [
        {
          role: "system",
          content: "moderation system prompt",
        },
        {
          role: "user",
          content: "very sensitive moderation sample",
        },
      ],
    });

    const providerBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    assert.equal(providerBody.zookLogBodyMode, undefined);
    assert.match(JSON.stringify(providerBody), /very sensitive moderation sample/);

    const requestLog = logger.records.find((entry) =>
      entry.message === "ai_novel local provider chat request body"
    );
    assert.ok(requestLog);
    const logBodyText = JSON.stringify(requestLog.body);
    assert.doesNotMatch(logBodyText, /very sensitive moderation sample/);
    assert.doesNotMatch(logBodyText, /moderation system prompt/);
    assert.match(logBodyText, /contentHash/);
    assert.match(logBodyText, /contentLength/);
  } finally {
    process.env.APP_ENV = previousAppEnv;
  }
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
