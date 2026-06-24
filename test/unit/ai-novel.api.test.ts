import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import type {
  EmbeddingProvider,
  EmbeddingResult,
} from "../../src/services/embedding-manager.ts";
import type {
  LLMCompletionResult,
  LLMMessage,
  LLMProvider,
  LLMStreamEvent,
} from "../../src/services/llm-manager.ts";
import { AI_NOVEL_MODEL_ROUTING_CONFIG_KEY } from "../../src/services/app-ai-routing-config.service.ts";
import {
  AI_NOVEL_CHAT_SCENE_KEYS,
  AI_NOVEL_EMBEDDING_SCENE_KEYS,
} from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
import { ApplicationError } from "../../src/shared/errors.ts";

const AI_TEST_KEY_ID = "logk_d5872ff066b8450b9aeed1c53f0df7f1";

function encodeAiKeyBase64(): { raw: Buffer; base64: string } {
  const raw = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
  return {
    raw,
    base64: raw.toString("base64"),
  };
}

function encryptAiPayload(payload: Record<string, unknown>, key: Buffer) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    keyId: AI_TEST_KEY_ID,
    algorithm: "aes-256-gcm",
    nonceBase64: nonce.toString("base64"),
    ciphertextBase64: Buffer.concat([ciphertext, tag]).toString("base64"),
  };
}

function decryptAiPayload(
  envelope: Record<string, unknown>,
  key: Buffer,
): Record<string, unknown> {
  const nonce = Buffer.from(String(envelope.nonceBase64), "base64");
  const payload = Buffer.from(String(envelope.ciphertextBase64), "base64");
  const ciphertext = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

function normalizeAiEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  return event.data && typeof event.data === "object"
    ? (event.data as Record<string, unknown>)
    : event;
}

async function collectSseEvents(
  stream: AsyncIterable<string> | undefined,
): Promise<Record<string, unknown>[]> {
  if (!stream) {
    return [];
  }

  let buffer = "";
  const events: Record<string, unknown>[] = [];
  for await (const chunk of stream) {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) {
        continue;
      }
      events.push(
        JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
      );
    }
  }
  return events;
}

function toolNamesFromProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
): string[] {
  return (
    (providerOptions?.tools as Array<Record<string, unknown>> | undefined) ?? []
  ).map((tool) =>
    String((tool.function as Record<string, unknown> | undefined)?.name ?? ""),
  );
}

function forcedStructuredToolPayload(
  toolName: string,
): Record<string, unknown> {
  if (toolName === "submit_chapter_summary") {
    return {
      summary: "雨夜事故引出调查线索",
      facts: { actualEvents: ["事故发生"] },
    };
  }
  if (toolName === "submit_chapter_review") {
    return {
      verdict: "pass",
      summary: "章节达成计划。",
      issues: [],
      planned: [],
      covered: [],
      missed: [],
      extra: [],
    };
  }
  if (toolName === "submit_snapshot") {
    return { snapshot: "长期线索仍围绕雨夜事故。" };
  }
  if (toolName === "submit_next_chapter_brief") {
    return {
      brief: "下一章推进调查线索。",
      required: { chapterGoal: "推进调查线索" },
      strategy: { mustCover: ["线索"] },
      contextRefs: {},
    };
  }
  return { ok: true };
}

interface CreateAiNovelRuntimeOptions {
  llmProvider?: LLMProvider;
}

async function createAiNovelRuntime(options: CreateAiNovelRuntimeOptions = {}) {
  const aiKey = encodeAiKeyBase64();
  const defaultLlmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "第八十一回……",
        finishReason: "stop",
        providerRequestId: "chat-req-001",
      };
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      const toolName = toolNamesFromProviderOptions(
        request.providerOptions,
      ).find((name) => name.startsWith("submit_"));
      if (toolName) {
        yield {
          type: "tool_call",
          toolCall: {
            id: `call_${toolName}_default`,
            name: toolName,
            input: forcedStructuredToolPayload(toolName),
          },
        };
        yield {
          type: "done",
          finishReason: "tool_calls",
        };
        return;
      }
      yield {
        type: "content_delta",
        text: "第八十",
      };
      yield {
        type: "content_delta",
        text: "一回……",
      };
      yield {
        type: "usage",
        usage: {
          promptTokens: 12,
          completionTokens: 34,
          totalTokens: 46,
        },
      };
      yield {
        type: "done",
        finishReason: "stop",
      };
    },
  };
  const llmProvider = options.llmProvider ?? defaultLlmProvider;

  const embeddingProvider: EmbeddingProvider = {
    async embed(request): Promise<EmbeddingResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        providerRequestId: "emb-req-001",
        vectors: [
          {
            index: 0,
            embedding: [0.1, 0.2, 0.3],
          },
          {
            index: 1,
            embedding: [0.4, 0.5, 0.6],
          },
        ],
      };
    },
  };

  const runtime = await createApplication({
    llmProviders: {
      bailian: llmProvider,
    },
    embeddingProviders: {
      bailian: embeddingProvider,
    },
    logEncryptionKeys: {
      [AI_TEST_KEY_ID]: aiKey.base64,
    },
  });

  await runtime.services.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "ainovel-free-creative",
    providers: [
      {
        key: "bailian",
        label: "阿里云百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "mock-bailian-api-key",
        timeoutMs: 30000,
      },
    ],
    models: [
      {
        key: "qwen3.6-plus",
        label: "Qwen 3.6 Plus",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "text-embedding-v4",
        label: "Text Embedding v4",
        kind: "embedding",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-free-creative",
        label: "AINovel Free Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-free-reasoning",
        label: "AINovel Free Reasoning",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-plus-creative",
        label: "AINovel Plus Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-plus-reasoning",
        label: "AINovel Plus Reasoning",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-super-creative",
        label: "AINovel Super Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-super-reasoning",
        label: "AINovel Super Reasoning",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-lowcost-structured",
        label: "AINovel Low-cost Structured",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen3.6-plus",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "ainovel-embedding-default",
        label: "AINovel Embedding Default",
        kind: "embedding",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "text-embedding-v4",
            enabled: true,
            weight: 100,
          },
        ],
      },
    ],
  });

  return {
    runtime,
    aiKey: aiKey.raw,
  };
}

test("ai_novel chat completions route requires bearer auth", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "AUTH_BEARER_REQUIRED");
});

test("ai_novel chat completions route resolves scene_key to scene route selection", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "system",
            content: "你是一个续写器。",
          },
          {
            role: "user",
            content: "请承接上一章继续写。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  assert.equal(data.sceneKey, "chapter_summary");
  const completion = (data.completion ?? {}) as Record<string, unknown>;
  assert.equal(completion.sceneRouteKey, "ainovel-lowcost-structured");
  assert.equal(completion.provider, "bailian");
  assert.equal(completion.providerModel, "qwen3.6-plus");
  assert.equal(
    (response.body as Record<string, unknown>).localDebugResponseText,
    JSON.stringify(forcedStructuredToolPayload("submit_chapter_summary")),
  );
});

test("ai_novel chat completion preserves assistant reasoning context for upstream requests", async () => {
  let capturedMessages: LLMMessage[] | undefined;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      capturedMessages = request.messages;
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "compacted context",
        finishReason: "stop",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      throw new Error("chat_compaction should not use stream");
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chat_compaction",
        messages: [
          {
            role: "assistant",
            content: "",
            reasoningContent: "上一轮隐藏推理",
            toolCalls: [
              {
                id: "call_1",
                name: "submit_context",
                input: { summary: "旧上下文" },
              },
            ],
          },
          {
            role: "tool",
            toolCallId: "call_1",
            content: "工具结果",
          },
          {
            role: "user",
            content: "继续压缩上下文。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  assert.ok(capturedMessages);
  assert.equal(capturedMessages![0]?.role, "assistant");
  assert.equal(capturedMessages![0]?.reasoningContent, "上一轮隐藏推理");
  assert.equal(capturedMessages![0]?.toolCalls?.[0]?.id, "call_1");
});

test("ai_novel structured workflow scenes use thinking streams with required tool validation", async () => {
  const structuredSceneKeys = [
    "chapter_summary",
    "chapter_draft_review",
    "snapshot_generation",
    "next_chapter_brief",
  ];
  let completeCalls = 0;
  let streamCalls = 0;
  const { runtime, aiKey } = await createAiNovelRuntime({
    llmProvider: {
      async complete(): Promise<LLMCompletionResult> {
        completeCalls += 1;
        throw new Error("structured workflow scenes should not use complete");
      },
      async *stream(request): AsyncIterable<LLMStreamEvent> {
        streamCalls += 1;
        assert.match(request.model.modelKey, /^ainovel-/);
        assert.equal(request.model.providerModel, "qwen3.6-plus");
        assert.equal(request.providerOptions?.enable_thinking, true);
        assert.equal(request.providerOptions?.tool_choice, "auto");
        const toolName = toolNamesFromProviderOptions(
          request.providerOptions,
        ).find((name) => name.startsWith("submit_"));
        assert.ok(toolName);
        yield {
          type: "reasoning_delta",
          text: "整理结构化工作流输出。",
        };
        yield {
          type: "tool_call",
          toolCall: {
            id: `call_${toolName}_1`,
            name: toolName,
            input: forcedStructuredToolPayload(toolName),
          },
        };
        yield {
          type: "done",
          finishReason: "tool_calls",
        };
      },
    },
  });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  for (const sceneKey of structuredSceneKeys) {
    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/ai/chat-completions",
      headers: {
        authorization: `Bearer ${token}`,
        host: "127.0.0.1:3100",
        "X-App-Id": "ai_novel",
      },
      body: encryptAiPayload(
        {
          scene_key: sceneKey,
          messages: [
            {
              role: "user",
              content: "Create structured output.",
            },
          ],
          context: {
            targetChapterIndex: 1,
            fragments: {},
          },
        },
        aiKey,
      ),
    });

    assert.equal(response.statusCode, 200);
    const decrypted = decryptAiPayload(
      response.body as Record<string, unknown>,
      aiKey,
    );
    assert.equal(decrypted.code, "OK");
    const data = (decrypted.data ?? {}) as Record<string, unknown>;
    const completion = (data.completion ?? {}) as Record<string, unknown>;
    assert.notEqual(completion.content, '{"ok":true}');
    assert.equal(typeof completion.content, "string");
    assert.ok(JSON.parse(String(completion.content)));
  }

  assert.equal(completeCalls, 0);
  assert.equal(streamCalls, structuredSceneKeys.length);
});

test("ai_novel structured workflow scenes retry when the required submit tool is missing", async () => {
  let streamCalls = 0;
  let retryMessages: LLMMessage[] = [];
  const { runtime, aiKey } = await createAiNovelRuntime({
    llmProvider: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("structured workflow scenes should not use complete");
      },
      async *stream(request): AsyncIterable<LLMStreamEvent> {
        streamCalls += 1;
        retryMessages = request.messages;
        assert.equal(request.providerOptions?.enable_thinking, true);
        assert.equal(request.providerOptions?.tool_choice, "auto");
        const toolName = toolNamesFromProviderOptions(
          request.providerOptions,
        ).find((name) => name.startsWith("submit_"));
        assert.ok(toolName);
        if (streamCalls === 1) {
          yield {
            type: "content_delta",
            text: "plain text instead of tool call",
          };
          yield {
            type: "done",
            finishReason: "stop",
          };
          return;
        }
        yield {
          type: "tool_call",
          toolCall: {
            id: `call_${toolName}_retry`,
            name: toolName,
            input: forcedStructuredToolPayload(toolName),
          },
        };
        yield {
          type: "done",
          finishReason: "tool_calls",
        };
      },
    },
  });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "Create structured output.",
          },
        ],
        context: {
          chapterText: "雨夜事故引出调查线索。",
        },
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  const completion = (data.completion ?? {}) as Record<string, unknown>;
  assert.ok(JSON.parse(String(completion.content)));
  assert.equal(streamCalls, 2);
  assert.match(
    retryMessages.at(-1)?.content ?? "",
    /must now call submit_chapter_summary exactly once/,
  );
});

test("ai_novel import_book_agent streams thinking tool calls with import progress", async () => {
  let capturedRequest:
    | {
        providerOptions?: Record<string, unknown>;
        messages: LLMMessage[];
      }
    | undefined;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      throw new Error("import_book_agent should not use non-stream complete");
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      capturedRequest = {
        providerOptions: request.providerOptions,
        messages: request.messages,
      };
      yield { type: "reasoning_delta", text: "Reading source evidence." };
      yield {
        type: "tool_call_delta",
        toolCallName: "submit_rolling_snapshot",
        toolArgumentPath: "snapshotText",
        text: "Chapter 1 establishes the imported conflict.",
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_import_plan",
          name: "submit_import_plan_update",
          input: {
            contract: {
              revisionId: "contract-1",
              storyPromise: "Imported source facts only.",
            },
            mainLine: {
              revisionId: "mainline-1",
              title: "Imported continuation",
            },
            evidence: ["chapter 1"],
          },
        },
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_rolling_snapshot",
          name: "submit_rolling_snapshot",
          input: {
            snapshotText: "Chapter 1 establishes the imported conflict.",
            evidence: ["chapter 1"],
          },
        },
      };
      yield { type: "done", finishReason: "tool_calls" };
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const payload = {
    scene_key: "import_book_agent",
    stream: true,
    context: {
      stepName: "read_cold_chunk",
      expectedTools: ["submit_import_plan_update", "submit_rolling_snapshot"],
      importContext: {
        chapters: [
          {
            chapterIndex: 1,
            title: "第一章",
            content: "雨夜里，罗家冤案的第一条线索浮出水面。",
          },
        ],
      },
    },
    messages: [
      {
        role: "user",
        content: "Read source text and submit required import tools.",
      },
    ],
    temperature: 0.2,
  };

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      host: "127.0.0.1:3110",
    },
    body: {
      ...encryptAiPayload(payload, aiKey),
      localDebugRequestPlaintext: JSON.stringify(payload),
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/event-stream; charset=utf-8");
  const events = await collectSseEvents(response.streamBody);
  assert.ok(capturedRequest);
  const providerOptions = capturedRequest!.providerOptions ?? {};
  assert.equal(providerOptions.enable_thinking, true);
  assert.equal(providerOptions.tool_choice, "auto");
  assert.deepEqual(providerOptions.stream_options, {
    first_event_timeout_ms: 120000,
    idle_timeout_ms: 90000,
  });
  assert.deepEqual(toolNamesFromProviderOptions(providerOptions), [
    "submit_import_plan_update",
    "submit_rolling_snapshot",
    "submit_chapter_summaries",
    "submit_snapshot",
    "submit_hot_handoff",
  ]);
  assert.match(
    String(capturedRequest!.messages[0]?.content ?? ""),
    /ImportBookAgent/,
  );

  const decryptedEvents = events.map((event) => decryptAiPayload(event, aiKey));
  const eventData = decryptedEvents.map(
    (event) => event.data as Record<string, unknown>,
  );
  assert.deepEqual(
    eventData.map((event) => event.type),
    [
      "local_debug_llm_request",
      "reasoning_delta",
      "tool_call_delta",
      "tool_call",
      "tool_call",
      "done",
    ],
  );
  assert.equal(eventData[2]?.toolCallName, "submit_rolling_snapshot");
  assert.equal(eventData[2]?.text, "Chapter 1 establishes the imported conflict.");
  const toolCall = eventData[3]?.toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "submit_import_plan_update");
  const localDebugLlmRequest = (eventData[0]?.payload ?? {}) as Record<
    string,
    unknown
  >;
  const requestBody = (localDebugLlmRequest.requestBody ?? {}) as Record<
    string,
    unknown
  >;
  const debugProviderOptions = (requestBody.providerOptions ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal(localDebugLlmRequest.sceneKey, "import_book_agent");
  assert.equal(requestBody.stream, true);
  assert.equal(debugProviderOptions.enable_thinking, true);
  assert.equal(debugProviderOptions.tool_choice, "auto");
  assert.deepEqual(debugProviderOptions.stream_options, {
    first_event_timeout_ms: 120000,
    idle_timeout_ms: 90000,
  });
});

test("ai_novel scene routing config validates all novel-engine chat scene keys", async () => {
  const { runtime } = await createAiNovelRuntime();
  const config =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  const expectedSceneKeys = [
    ...AI_NOVEL_CHAT_SCENE_KEYS,
    ...AI_NOVEL_EMBEDDING_SCENE_KEYS,
  ].sort();

  assert.deepEqual(Object.keys(config.scenes).sort(), expectedSceneKeys);
  for (const sceneKey of AI_NOVEL_CHAT_SCENE_KEYS) {
    assert.equal(config.scenes[sceneKey]?.kind, "chat");
  }
  for (const sceneKey of AI_NOVEL_EMBEDDING_SCENE_KEYS) {
    assert.equal(config.scenes[sceneKey]?.kind, "embedding");
  }
});

test("ai_novel chat completions route supports encrypted SSE streaming", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "write_turn",
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/event-stream; charset=utf-8");
  assert.equal((response.body as Record<string, unknown>).message, "streaming");
  const events = await collectSseEvents(response.streamBody);
  assert.equal(events.length, 4);

  const decryptedEvents = events.map((event) => decryptAiPayload(event, aiKey));
  assert.deepEqual(
    decryptedEvents.map(
      (event) => (event.data as Record<string, unknown>).type,
    ),
    ["content_delta", "content_delta", "usage", "done"],
  );
  assert.equal(
    (
      (decryptedEvents[0]?.data as Record<string, unknown>).text ?? ""
    ).toString(),
    "第八十",
  );
  assert.equal(
    (
      (decryptedEvents[1]?.data as Record<string, unknown>).text ?? ""
    ).toString(),
    "一回……",
  );
  const usage = ((decryptedEvents[2]?.data as Record<string, unknown>).usage ??
    {}) as Record<string, unknown>;
  assert.equal(usage.contextWindowTokens, 1_000_000);
  assert.equal(usage.contextUsedRatio, 12 / 1_000_000);
  const doneCompletion = ((decryptedEvents[3]?.data as Record<string, unknown>)
    .completion ?? {}) as Record<string, unknown>;
  const doneUsage = ((decryptedEvents[3]?.data as Record<string, unknown>)
    .usage ?? {}) as Record<string, unknown>;
  assert.equal(doneUsage.contextWindowTokens, 1_000_000);
  assert.equal(doneCompletion.sceneRouteKey, "ainovel-free-creative");
  assert.equal(doneCompletion.content, "第八十一回……");
  assert.equal(doneCompletion.provider, undefined);
  assert.equal(doneCompletion.providerModel, undefined);
});

test("ai_novel local debug envelopes expose upstream LLM request body", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const payload = {
    scene_key: "write_turn",
    stream: true,
    messages: [
      {
        role: "user",
        content: "继续写当前章节。",
      },
    ],
  };

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: {
      ...encryptAiPayload(payload, aiKey),
      localDebugRequestPlaintext: JSON.stringify(payload),
    },
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  const debugEvent = decryptedEvents[0];
  assert.equal(debugEvent.type, "local_debug_llm_request");
  const debugPayload = debugEvent.payload as Record<string, unknown>;
  const requestBody = debugPayload.requestBody as Record<string, unknown>;
  const messages = requestBody.messages as Record<string, unknown>[];
  const providerOptions = requestBody.providerOptions as Record<
    string,
    unknown
  >;
  assert.equal(debugPayload.sceneKey, "write_turn");
  assert.equal(debugPayload.sceneRouteKey, "ainovel-free-creative");
  assert.equal(requestBody.sceneRouteKey, "ainovel-free-creative");
  assert.equal("modelKey" in requestBody, false);
  assert.equal(messages[0].role, "system");
  assert.ok(
    String(messages[0].content ?? "").includes("write-mode AINovel agent"),
  );
  assert.ok(Array.isArray(providerOptions.tools));
  assert.equal(decryptedEvents[1].type, "content_delta");
});

test("ai_novel audit-file endpoint is hidden outside local debug hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "zook-audit-hidden-"));
  const runtime = await createApplication({ aiNovelAuditFileRoot: root });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/debug/audit-file",
    headers: {
      authorization: `Bearer ${token}`,
      host: "api.example.com",
      "X-App-Id": "ai_novel",
    },
    body: {
      sessionId: "session_1",
      html: "<!doctype html><html></html>",
    },
  });

  assert.equal(response.statusCode, 404);
});

test("ai_novel audit-file endpoint is hidden in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const root = await mkdtemp(join(tmpdir(), "zook-audit-production-"));
    const runtime = await createApplication({ aiNovelAuditFileRoot: root });
    const token = runtime.services.tokenService.issueAccessToken(
      "user_alice",
      "ai_novel",
    );

    const response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/debug/audit-file",
      headers: {
        authorization: `Bearer ${token}`,
        host: "127.0.0.1:3100",
        "X-App-Id": "ai_novel",
      },
      body: {
        sessionId: "session_1",
        html: "<!doctype html><html></html>",
      },
    });

    assert.equal(response.statusCode, 404);
  } finally {
    if (previousNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test("ai_novel audit-file endpoint requires ai_novel bearer auth", async () => {
  const root = await mkdtemp(join(tmpdir(), "zook-audit-auth-"));
  const runtime = await createApplication({ aiNovelAuditFileRoot: root });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/debug/audit-file",
    headers: {
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: {
      sessionId: "session_1",
      html: "<!doctype html><html></html>",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "AUTH_BEARER_REQUIRED");
});

test("ai_novel audit-file endpoint writes, overwrites, and sanitizes session path", async () => {
  const root = await mkdtemp(join(tmpdir(), "zook-audit-file-"));
  const runtime = await createApplication({ aiNovelAuditFileRoot: root });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const baseRequest = {
    method: "POST",
    path: "/api/v1/ai_novel/debug/audit-file",
    headers: {
      authorization: `Bearer ${token}`,
      host: "localhost:3100",
      "X-App-Id": "ai_novel",
    },
  };

  const first = await runtime.app.handle({
    ...baseRequest,
    body: {
      sessionId: "../bad/session",
      html: "<!doctype html><html>first</html>",
    },
  });
  const second = await runtime.app.handle({
    ...baseRequest,
    body: {
      sessionId: "../bad/session",
      html: "<!doctype html><html>second</html>",
    },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const firstData = first.body.data as Record<string, unknown>;
  const secondData = second.body.data as Record<string, unknown>;
  assert.equal(
    firstData.filePath,
    join(root, "bad_session", "generation-audit.html"),
  );
  assert.equal(secondData.filePath, firstData.filePath);
  assert.equal(
    secondData.viewUrl,
    "http://localhost:3100/api/v1/ai_novel/debug/audit-file/bad_session",
  );
  assert.equal(
    await readFile(firstData.filePath as string, "utf8"),
    "<!doctype html><html>second</html>",
  );
  assert.match(
    String(secondData.fileUrl),
    /^file:\/\/.*generation-audit\.html$/,
  );
  assert.match(String(secondData.updatedAt), /^\d{4}-\d{2}-\d{2}T/);

  const view = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/debug/audit-file/bad_session",
    headers: {
      host: "localhost:3100",
    },
  });
  let viewedHtml = "";
  for await (const chunk of view.streamBody ?? []) {
    viewedHtml += chunk;
  }
  assert.equal(view.statusCode, 200);
  assert.equal(view.contentType, "text/html; charset=utf-8");
  assert.equal(viewedHtml, "<!doctype html><html>second</html>");
});

test("ai_novel kickoff_turn stream emits normalized kickoff action events", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "content_delta",
        text: "我们先把这本书立住。",
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_meta_1",
          name: "update_meta",
          input: {
            titleCandidate: "赛博夜行档案",
            storyPromise: "赛博都市异能调查爽文。",
            storyAnchors: [
              {
                label: "被流放的异能调查员",
                role: "单主角",
                rules: ["被公司流放后调查记忆走私案"],
              },
            ],
            trigger: "卷入记忆走私案。",
            drive: { mode: "discover", object: "记忆走私案真相" },
            pressureSources: ["公司追杀", "城市神经网络"],
            stakes: {
              external: "城市被记忆交易吞掉",
              relational: "旧搭档被卷入",
              internal: "主角无法确认自己的记忆",
            },
            worldConstraints: ["异能会留下可追踪的记忆残响"],
            changeHorizon: "从自保调查走向揭开城市权力结构。",
            premiseScale: {
              length: { preset: "long", note: "长篇" },
              chapterLength: {
                preset: "standard",
                minChars: 3000,
                maxChars: 5000,
                note: "标准网文章",
              },
              pov: { preset: "single_pov", note: "单视角" },
              threadDensity: {
                preset: "single_main_thread",
                note: "主线为主",
              },
              pace: { preset: "fast", note: "快节奏" },
            },
            language: "简体中文",
            toneRegister: "冷峻但爽快",
            readiness: 0.2,
          },
        },
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_ready_1",
          name: "ready",
          input: {
            summary: "一部冷峻爽快的赛博都市异能调查长篇。",
            currentArcPlan: {
              revisionId: "kickoff",
              title: "记忆走私开局",
              summary: "前六章让主角从流放状态进入第一段调查。",
              arcPromise: "用冷峻都市调查推进记忆走私真相。",
              arcRules: ["不要提前揭开记忆走私幕后主使。"],
              startChapterIndex: 1,
              endChapterIndex: 6,
              beats: Array.from({ length: 6 }, (_, index) => ({
                id: `beat-${index + 1}`,
                chapterIndex: index + 1,
                goal: `推进第 ${index + 1} 个调查节点。`,
                mustCover: [],
                forbidden: [],
                change: `调查态势发生第 ${index + 1} 次变化。`,
                endBoundary: `停在第 ${index + 1} 个调查节点完成,不要写到下一章。`,
              })),
            },
          },
        },
      };
      yield {
        type: "usage",
        usage: {
          promptTokens: 21,
          completionTokens: 55,
          totalTokens: 76,
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
            storyPromise: "校园超自然异常调查。",
            storyAnchors: [
              {
                label: "转学生",
                name: "林砚",
                role: "单主角",
                rules: ["以转学生视角进入旧校舍异常"],
              },
              {
                label: "旧校舍",
                role: "核心舞台",
                rules: ["旧校舍承载主要异常线索"],
              },
            ],
            trigger: "第一晚听见广播点名不存在的学生。",
            language: "简体中文",
          },
        },
        messages: [
          {
            role: "user",
            content: "写一个赛博都市异能故事，节奏快一点。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  const types = decryptedEvents.map((event) => event.type);
  assert.deepEqual(types, [
    "content_delta",
    "tool_call",
    "tool_call",
    "usage",
    "done",
  ]);
  const usageEvent = (decryptedEvents[3].usage ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal(usageEvent.contextWindowTokens, 1_000_000);
  assert.equal(usageEvent.contextUsedRatio, 21 / 1_000_000);

  const updateMeta = decryptedEvents[1].toolCall as Record<string, unknown>;
  assert.equal(updateMeta.name, "update_meta");
  assert.equal(
    (
      (updateMeta.input as Record<string, unknown>).titleCandidate ?? ""
    ).toString(),
    "赛博夜行档案",
  );
  assert.equal(
    (updateMeta.input as Record<string, unknown>).readiness ?? 0,
    0.2,
  );
  assert.equal(
    (updateMeta.input as Record<string, unknown>).storyPromise,
    "赛博都市异能调查爽文。",
  );
  assert.deepEqual((updateMeta.input as Record<string, unknown>).storyAnchors, [
    {
      label: "被流放的异能调查员",
      role: "单主角",
      rules: ["被公司流放后调查记忆走私案"],
    },
  ]);
  assert.deepEqual((updateMeta.input as Record<string, unknown>).drive, {
    mode: "discover",
    object: "记忆走私案真相",
  });
  const ready = decryptedEvents[2].toolCall as Record<string, unknown>;
  assert.equal(ready.name, "ready");
  assert.equal(
    (ready.input as Record<string, unknown>).summary,
    "一部冷峻爽快的赛博都市异能调查长篇。",
  );
});

test("ai_novel kickoff_turn relays update_meta payloads without backend repair", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-deprecated-meta-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_meta_deprecated",
          name: "update_meta",
          input: {
            unknownTitleField: "烬骨长明",
            unknownSummaryField: "被逐弟子在边荒靠残魂活下来。",
            readiness: 0.8,
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [
          {
            role: "user",
            content: "写一个玄幻升级流，后面你帮我定。",
          },
        ],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  const updateMeta = decryptedEvents.find((event) => event.type === "tool_call")
    ?.toolCall as Record<string, unknown>;
  assert.equal(updateMeta.name, "update_meta");
  assert.deepEqual(updateMeta.input, {
    unknownTitleField: "烬骨长明",
    unknownSummaryField: "被逐弟子在边荒靠残魂活下来。",
    readiness: 0.8,
  });
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("kickoff tool payload"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn relays inverted chapterLength ranges to the client agent", async () => {
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_meta_scale_range",
          name: "update_meta",
          input: {
            premiseScale: {
              length: { preset: "long", note: "长篇" },
              chapterLength: {
                preset: "standard",
                minChars: 5000,
                maxChars: 3000,
                note: "标准网文章",
              },
              pov: { preset: "single_pov", note: "单视角" },
              threadDensity: {
                preset: "single_main_thread",
                note: "主线为主",
              },
              pace: { preset: "fast", note: "快节奏" },
            },
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        messages: [{ role: "user", content: "设定单章长度。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  const updateMeta = decryptedEvents.find((event) => event.type === "tool_call")
    ?.toolCall as Record<string, unknown>;
  const input = updateMeta.input as Record<string, unknown>;
  const premiseScale = input.premiseScale as Record<string, unknown>;
  const chapterLength = premiseScale.chapterLength as Record<string, unknown>;
  assert.equal(chapterLength.minChars, 5000);
  assert.equal(chapterLength.maxChars, 3000);
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("kickoff tool payload"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn relays ask_question payloads without backend normalization", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-normalize-ask-question-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_1",
          name: "ask_question",
          input: {
            question: "  主角被逐出山门后，故事的核心走向是什么？  ",
            options: [
              { label: "复仇打脸", subtitle: "向背叛者清算" },
              { label: "另起炉灶", subtitle: "建立新势力" },
              { label: "洗冤归宗", subtitle: "重回宗门" },
              { label: "揭开阴谋", subtitle: "冤案背后另有黑手" },
              { label: "浪迹天涯", subtitle: "不再回头" },
              { label: "建立宗门", subtitle: "另立山门" },
              { label: "隐姓埋名", subtitle: "彻底离开旧身份" },
              { label: "孤身远走", subtitle: "独自寻找新生路" },
            ],
            allowCustom: true,
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
            storyPromise: "校园超自然异常调查。",
            storyAnchors: [
              {
                label: "转学生",
                name: "林砚",
                role: "单主角",
                rules: ["以转学生视角进入旧校舍异常"],
              },
              {
                label: "旧校舍",
                role: "核心舞台",
                rules: ["旧校舍承载主要异常线索"],
              },
            ],
            trigger: "第一晚听见广播点名不存在的学生。",
            language: "简体中文",
          },
        },
        messages: [
          {
            role: "user",
            content: "继续推进这个故事。",
          },
        ],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  const askQuestion = decryptedEvents.find(
    (event) => event.type === "tool_call",
  );
  assert.ok(askQuestion);
  const toolCall = askQuestion!.toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "ask_question");
  assert.deepEqual((toolCall.input as Record<string, unknown>).options, [
    { label: "复仇打脸", subtitle: "向背叛者清算" },
    { label: "另起炉灶", subtitle: "建立新势力" },
    { label: "洗冤归宗", subtitle: "重回宗门" },
    { label: "揭开阴谋", subtitle: "冤案背后另有黑手" },
    { label: "浪迹天涯", subtitle: "不再回头" },
    { label: "建立宗门", subtitle: "另立山门" },
    { label: "隐姓埋名", subtitle: "彻底离开旧身份" },
    { label: "孤身远走", subtitle: "独自寻找新生路" },
  ]);
  assert.equal(
    (toolCall.input as Record<string, unknown>).question,
    "  主角被逐出山门后，故事的核心走向是什么？  ",
  );
  assert.equal((toolCall.input as Record<string, unknown>).allowCustom, true);
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("kickoff tool payload"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn relays JSON-string ask_question options", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-json-string-question-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_json_string_options",
          name: "ask_question",
          input: {
            question: "你希望用什么叙事视角？",
            options:
              '["单主角第三人称——全程跟随主角视角","单主角第一人称——以我视角叙述"]',
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.equal(
    decryptedEvents.some((event) => event.type === "error"),
    false,
  );
  const toolCall = decryptedEvents.find((event) => event.type === "tool_call")
    ?.toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "ask_question");
  assert.equal(
    (toolCall.input as Record<string, unknown>).options,
    '["单主角第三人称——全程跟随主角视角","单主角第一人称——以我视角叙述"]',
  );
});

test("ai_novel kickoff_turn relays kickoff tool name casing to the client agent", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-tool-name-repair-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_case_mismatch",
          name: "Ask_Question",
          input: {
            question: "主角被逐出宗门后，第一阶段的舞台在哪里？",
            options: [
              { label: "边境小城", subtitle: "低调发育，逐步翻身" },
              { label: "妖兽山脉", subtitle: "危机密集，升级更快" },
            ],
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "Ask_Question");
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("kickoff tool name repaired"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn relays invalid ask_question payload without backend repair", async () => {
  let streamCalls = 0;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-tool-repair-recovered-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      streamCalls += 1;
      yield {
        type: "content_delta",
        text: "我先确认一个关键点。",
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_invalid_once",
          name: "ask_question",
          input: {
            question: "主角的第一阶段目标是什么？",
          },
        },
      };
      yield {
        type: "usage",
        usage: {
          promptTokens: 10,
          completionTokens: 2,
          totalTokens: 12,
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.equal(streamCalls, 1);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["content_delta", "tool_call", "usage", "done"],
  );
  const toolCall = decryptedEvents[1].toolCall as Record<string, unknown>;
  assert.equal(toolCall.id, "tool_question_invalid_once");
  assert.equal(toolCall.name, "ask_question");
  assert.deepEqual(toolCall.input, {
    question: "主角的第一阶段目标是什么？",
  });
  const usageEvent = decryptedEvents[2].usage as Record<string, unknown>;
  assert.equal(usageEvent.promptTokens, 10);
  assert.equal(usageEvent.completionTokens, 2);
  assert.equal(usageEvent.totalTokens, 12);
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("invalid tool repair"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn relays repeated invalid ask_question payloads as a single backend turn", async () => {
  let streamCalls = 0;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-tool-repair-exhausted-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      streamCalls += 1;
      yield {
        type: "tool_call",
        toolCall: {
          id: `tool_question_still_invalid_${streamCalls}`,
          name: "ask_question",
          input: {
            question: "主角的第一阶段目标是什么？",
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.equal(streamCalls, 1);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.id, "tool_question_still_invalid_1");
  assert.equal(toolCall.name, "ask_question");
  assert.deepEqual(toolCall.input, {
    question: "主角的第一阶段目标是什么？",
  });
});

test("ai_novel kickoff_turn accepts one ask_question option at runtime", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-one-option-question-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_one",
          name: "ask_question",
          input: {
            question: "就按这个方向继续吗？",
            options: ["继续"],
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [
          {
            role: "user",
            content: "先这样吧。",
          },
        ],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.equal(
    decryptedEvents.some((event) => event.type === "error"),
    false,
  );
  const askQuestion = decryptedEvents.find(
    (event) => event.type === "tool_call",
  );
  assert.ok(askQuestion);
  const toolCall = askQuestion!.toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "ask_question");
  assert.deepEqual((toolCall.input as Record<string, unknown>).options, [
    "继续",
  ]);
});

test("ai_novel kickoff_turn relays malformed ask_question string options", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-invalid-question-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_question_string_options",
          name: "ask_question",
          input: {
            question: "故事发生在什么样的世界？",
            options: `["纯现代世界，异世界元素悄悄渗透进来", "现代世界与异世界有通道/连接点", "主角是唯一从异世界来的"异类"", "还没想好，你来定"]`,
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [
          {
            role: "user",
            content: "继续。",
          },
        ],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "ask_question");
  assert.equal(toolCall.id, "tool_question_string_options");
  assert.equal(
    (toolCall.input as Record<string, unknown>).options,
    `["纯现代世界，异世界元素悄悄渗透进来", "现代世界与异世界有通道/连接点", "主角是唯一从异世界来的"异类"", "还没想好，你来定"]`,
  );
  assert.equal(
    runtime.logger.records.some((entry) =>
      String(entry.message).includes("kickoff tool payload rejected"),
    ),
    false,
  );
});

test("ai_novel kickoff_turn assigns a fallback tool_call id when upstream omits it", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-fallback-id-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "",
          name: "read_meta",
          input: {},
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续推进这个故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "read_meta");
  assert.match(String(toolCall.id), /^ainovel-.*_kickoff_tool_0$/);
});

test("ai_novel kickoff_turn relays generic tool argument deltas before final tool_call", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-tool-delta-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "content_delta",
        text: "我先问一个关键问题。",
      };
      yield {
        type: "tool_call_delta",
        toolCallId: "call_question_delta",
        toolCallName: "ask_question",
        text: '{"question":"你希望主角是谁？"',
      };
      yield {
        type: "tool_call_delta",
        toolCallId: "call_question_delta",
        toolCallName: "ask_question",
        text: ',"options":[]}',
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_question_delta",
          name: "ask_question",
          input: {
            question: "你希望主角是谁？",
            options: [
              {
                label: "普通学生",
                subtitle: "从日常被异常打破开始。",
              },
              {
                label: "转校生",
                subtitle: "带着秘密进入校园。",
              },
            ],
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "写一个校园超自然故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["content_delta", "tool_call_delta", "tool_call_delta", "tool_call", "done"],
  );
  assert.equal(decryptedEvents[1].toolCallName, "ask_question");
  assert.equal(decryptedEvents[2].toolCallName, "ask_question");
  const toolCall = decryptedEvents[3].toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "ask_question");
  const doneCompletion = (decryptedEvents[4]?.completion ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal(doneCompletion.finishReason, "tool_calls");
});

test("ai_novel kickoff_turn builds one merged system message with workflow prompt and summary", async () => {
  let capturedMessages: Array<{ role: string; content?: string }> | undefined;
  let capturedTools: unknown[] | undefined;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-prompt-001",
      };
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      capturedMessages = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      capturedTools = (request.providerOptions?.tools as unknown[]) ?? [];
      yield {
        type: "content_delta",
        text: "我们先把主角和开局钉稳。",
      };
      yield {
        type: "done",
        finishReason: "stop",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
      "X-App-Locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
            storyPromise: "校园超自然异常调查。",
            storyAnchors: [
              {
                label: "转学生",
                name: "林砚",
                role: "单主角",
                rules: ["以转学生视角进入旧校舍异常"],
              },
              {
                label: "旧校舍",
                role: "核心舞台",
                rules: ["旧校舍承载主要异常线索"],
              },
            ],
            trigger: "第一晚听见广播点名不存在的学生。",
            language: "简体中文",
          },
        },
        messages: [
          {
            role: "user",
            content: "写一个校园超自然故事，从一个异常事件开始。",
          },
        ],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  assert.ok(events.length > 0);
  assert.ok(capturedMessages);

  const systemMessages = capturedMessages!.filter(
    (message) => message.role === "system",
  );
  assert.equal(systemMessages.length, 1);
  assert.match(String(systemMessages[0]?.content ?? ""), /## Role/);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /## Workflow discipline/,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /may call multiple tools/i,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /exactly one focused ask_question/i,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /options.*real JSON array of objects/i,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /Never pass arrays or objects as strings containing JSON/i,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /Current kickoff summary:/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /include summary/i);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /titleCandidate must be a concrete book title/i,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /protagonist anchor has a concrete non-placeholder `name`/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /待定书名/);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /fixed English preset values/,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /chapterLength\.minChars/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /- titleCandidate: /);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /Current canonical premise \/ contract:/,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /- storyPromise: 校园超自然异常调查。/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /"name":"林砚"/);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /- language: 简体中文/,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /Localized authoring glossary:/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /开书、开始写、正式开始/);
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /start this book project from the current kickoff plan/,
  );
  assert.match(
    String(systemMessages[0]?.content ?? ""),
    /user chose to modify the ready proposal/,
  );
  assert.match(String(systemMessages[0]?.content ?? ""), /call ready/);
  assert.match(String(systemMessages[0]?.content ?? ""), /call update_meta/);
  assert.doesNotMatch(
    String(systemMessages[0]?.content ?? ""),
    /Do not ask what these words mean/,
  );
  assert.doesNotMatch(
    String(systemMessages[0]?.content ?? ""),
    /Do not treat this as opening an existing book file/,
  );
  const askQuestionTool = capturedTools?.find((tool) => {
    const fn = (tool as Record<string, unknown>).function as
      | Record<string, unknown>
      | undefined;
    return fn?.name === "ask_question";
  }) as Record<string, unknown> | undefined;
  assert.ok(askQuestionTool);
  const askQuestionFn = askQuestionTool.function as Record<string, unknown>;
  const parameters = askQuestionFn.parameters as Record<string, unknown>;
  const properties = parameters.properties as Record<string, unknown>;
  assert.equal((properties.question as Record<string, unknown>).type, "string");
  const options = properties.options as Record<string, unknown>;
  assert.match(String(options.description), /real JSON array/);
  const optionItem = options.items as Record<string, unknown>;
  assert.deepEqual(optionItem.required, ["label", "subtitle"]);
  const readyTool = capturedTools?.find((tool) => {
    const fn = (tool as Record<string, unknown>).function as
      | Record<string, unknown>
      | undefined;
    return fn?.name === "ready";
  }) as Record<string, unknown> | undefined;
  assert.ok(readyTool);
  const readyFn = readyTool.function as Record<string, unknown>;
  assert.match(
    String(readyFn.description),
    /Call this again after a previous ready result says the user chose to modify the ready proposal/,
  );
  const updateMetaTool = capturedTools?.find((tool) => {
    const fn = (tool as Record<string, unknown>).function as
      | Record<string, unknown>
      | undefined;
    return fn?.name === "update_meta";
  }) as Record<string, unknown> | undefined;
  assert.ok(updateMetaTool);
  const updateMetaFn = updateMetaTool.function as Record<string, unknown>;
  const updateMetaParameters = updateMetaFn.parameters as Record<
    string,
    unknown
  >;
  const updateMetaProperties = updateMetaParameters.properties as Record<
    string,
    unknown
  >;
  const premiseScale = updateMetaProperties.premiseScale as Record<
    string,
    unknown
  >;
  const storyAnchors = updateMetaProperties.storyAnchors as Record<
    string,
    unknown
  >;
  const storyAnchorItems = storyAnchors.items as Record<string, unknown>;
  const storyAnchorProperties = storyAnchorItems.properties as Record<
    string,
    unknown
  >;
  assert.ok(storyAnchorProperties.name);
  assert.deepEqual(premiseScale.required, [
    "length",
    "chapterLength",
    "pov",
    "threadDensity",
    "pace",
  ]);
  const scaleProperties = premiseScale.properties as Record<string, unknown>;
  const chapterLength = scaleProperties.chapterLength as Record<
    string,
    unknown
  >;
  assert.deepEqual(chapterLength.required, ["preset", "note"]);
});

test("ai_novel kickoff_turn streams a single round and relays read_meta tool calls without internal loop", async () => {
  let callCount = 0;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-read-meta-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      callCount += 1;
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_read_1",
          name: "read_meta",
          input: {},
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "烬骨长明",
            readiness: 0.1,
            storyPromise: "被逐出宗门的天才少年踏上翻案之路。",
            storyAnchors: [
              {
                label: "林烬",
                role: "单主角",
                rules: ["被栽赃逐出宗门后得到古老器灵"],
              },
            ],
            changeHorizon: "从边荒求生开始翻案。",
            premiseScale: {
              length: { preset: "long", note: "长篇" },
              chapterLength: {
                preset: "standard",
                minChars: 3000,
                maxChars: 5000,
                note: "标准网文章",
              },
              pov: { preset: "single_pov", note: "单视角" },
              threadDensity: {
                preset: "single_main_thread",
                note: "主线为主",
              },
              pace: { preset: "fast", note: "快节奏" },
            },
          },
        },
        messages: [{ role: "user", content: "继续推进这个故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  assert.equal(
    (
      (decryptedEvents[0].toolCall as Record<string, unknown>).name ?? ""
    ).toString(),
    "read_meta",
  );
  assert.equal(callCount, 1);
});

test("ai_novel kickoff_turn stream allows assistant-only freeform turns", async () => {
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-freeform-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "content_delta",
        text: "我们先把主角和开局钉稳。",
      };
      yield {
        type: "done",
        finishReason: "stop",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续推进这个故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["content_delta", "done"],
  );
  const doneCompletion = (decryptedEvents[1]?.completion ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal(doneCompletion.content, "我们先把主角和开局钉稳。");
});

test("ai_novel kickoff_turn enables thinking and forwards reasoning deltas", async () => {
  let capturedEnableThinking: unknown;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-thinking-001",
      };
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      capturedEnableThinking = request.providerOptions?.enable_thinking;
      yield {
        type: "reasoning_delta",
        text: "先确认故事驱动力",
      };
      yield {
        type: "content_delta",
        text: "我们先把主角和冲突钉稳。",
      };
      yield {
        type: "done",
        finishReason: "stop",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续推进这个故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);

  assert.equal(capturedEnableThinking, true);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["reasoning_delta", "content_delta", "done"],
  );
  assert.equal(decryptedEvents[0].text, "先确认故事驱动力");
});

test("ai_novel write_turn injects server prompt and documented write tools", async () => {
  let capturedMessages: Array<{ role: string; content?: string }> | undefined;
  let capturedToolNames: string[] = [];
  let capturedTools: Array<Record<string, unknown>> = [];
  let capturedEnableThinking: unknown;
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      capturedEnableThinking = request.providerOptions?.enable_thinking;
      capturedMessages = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const tools = request.providerOptions?.tools as
        | Array<Record<string, unknown>>
        | undefined;
      capturedTools = tools ?? [];
      capturedToolNames = (tools ?? []).map((tool) =>
        String(
          (tool.function as Record<string, unknown> | undefined)?.name ?? "",
        ),
      );
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_write_1",
          name: "write_draft",
          input: {
            title: "雨夜线索",
            content: "第一段正文。",
          },
        },
      };
      yield {
        type: "content_delta",
        text: "我已经把本章草稿推进了一版。",
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "write_turn",
        stream: true,
        context: {
          contract: "POV 固定为女主第三人称。",
          mainLine: {
            current_arc: "女主调查记忆走私案。",
          },
          currentChapter: {
            chapterId: 2,
            title: "雨夜线索",
          },
        },
        messages: [
          {
            role: "system",
            content:
              "client supplied system prompt should not become the stable scene prompt",
          },
          {
            role: "user",
            content: "把这一章改得更有压迫感。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "content_delta", "done"],
  );
  assert.equal(capturedEnableThinking, true);
  assert.ok(capturedMessages);
  assert.equal(
    capturedMessages!.filter((message) => message.role === "system").length,
    1,
  );
  assert.equal(capturedMessages![0].role, "system");
  assert.match(
    String(capturedMessages![0].content ?? ""),
    /write-mode AINovel agent/,
  );
  assert.equal(capturedMessages![1].role, "user");
  assert.match(
    String(capturedMessages![1].content ?? ""),
    /Dynamic scene context from client payload/,
  );
  assert.match(String(capturedMessages![1].content ?? ""), /雨夜线索/);
  assert.match(
    String(capturedMessages![1].content ?? ""),
    /把这一章改得更有压迫感/,
  );
  assert.equal(
    capturedMessages!.some((message) =>
      String(message.content ?? "").includes("client supplied system prompt"),
    ),
    false,
  );
  assert.deepEqual(
    capturedToolNames.sort(),
    [
      "ask_question",
      "read_book_contract",
      "read_chapter_frame",
      "read_current_brief",
      "read_draft",
      "read_main_line",
      "read_story_window",
      "search_story_history",
      "set_book_contract",
      "set_main_line",
      "write_draft",
    ].sort(),
  );
  const contractTool = capturedTools.find(
    (tool) =>
      String(
        (tool.function as Record<string, unknown> | undefined)?.name ?? "",
      ) === "set_book_contract",
  );
  assert.ok(contractTool);
  const contractParameters = (contractTool.function as Record<string, unknown>)
    .parameters as Record<string, unknown>;
  const patchSchema = (contractParameters.properties as Record<string, unknown>)
    .patch as Record<string, unknown>;
  const patchProperties = patchSchema.properties as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(patchProperties).sort(),
    [
      "changeHorizon",
      "drive",
      "extras",
      "focalization",
      "language",
      "pressureSources",
      "readiness",
      "scale",
      "stakes",
      "startState",
      "storyAnchors",
      "storyPromise",
      "toneRegister",
      "trigger",
      "worldConstraints",
    ].sort(),
  );
  const askQuestionTool = capturedTools.find(
    (tool) =>
      String(
        (tool.function as Record<string, unknown> | undefined)?.name ?? "",
      ) === "ask_question",
  );
  assert.ok(askQuestionTool);
  const askQuestionParameters = (
    askQuestionTool.function as Record<string, unknown>
  ).parameters as Record<string, unknown>;
  const askQuestionProperties = askQuestionParameters.properties as Record<
    string,
    unknown
  >;
  assert.equal(
    (askQuestionProperties.question as Record<string, unknown>).type,
    "string",
  );
  const optionsSchema = askQuestionProperties.options as Record<
    string,
    unknown
  >;
  assert.equal(optionsSchema.type, "array");
  const optionItemSchema = optionsSchema.items as Record<string, unknown>;
  assert.deepEqual(optionItemSchema.required, ["label", "subtitle"]);
});

test("ai_novel write_turn assigns fallback ids for blank prompted tool calls", async () => {
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "tool_call",
        toolCall: {
          id: "",
          name: "read_draft",
          input: {
            offset: 0,
            limit: 100,
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "write_turn",
        stream: true,
        messages: [
          {
            role: "user",
            content: "读取当前草稿再继续写。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.name, "read_draft");
  assert.match(String(toolCall.id), /^ainovel-.*_prompted_tool_0$/);
});

test("ai_novel chapter_draft supplies read, search history, and draft write tools", async () => {
  let capturedToolNames: string[] = [];
  let capturedMessages: Array<{ role: string; content?: string }> | undefined;
  let capturedEnableThinking: unknown;
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      capturedEnableThinking = request.providerOptions?.enable_thinking;
      capturedMessages = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const tools = request.providerOptions?.tools as
        | Array<Record<string, unknown>>
        | undefined;
      capturedToolNames = (tools ?? []).map((tool) =>
        String(
          (tool.function as Record<string, unknown> | undefined)?.name ?? "",
        ),
      );
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_draft_1",
          name: "write_draft",
          input: {
            title: "第一章 夜航",
            content: "夜航开始。",
          },
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_draft",
        stream: true,
        context: {
          contract: "冷硬科幻悬疑。",
          targetChapter: {
            chapterId: 0,
            chapterIndex: 1,
          },
          brief: "用雨夜事故开篇。",
        },
        messages: [
          {
            role: "user",
            content: "生成目标章节首稿。",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  assert.equal(capturedEnableThinking, true);
  assert.deepEqual(capturedToolNames.sort(), [
    "read_draft",
    "search_story_history",
    "write_draft",
  ]);
  assert.ok(capturedMessages);
  assert.equal(capturedMessages.length, 2);
  assert.equal(capturedMessages[0].role, "system");
  assert.equal(capturedMessages[1].role, "user");
  assert.match(String(capturedMessages![0].content ?? ""), /ChapterDraftAgent/);
  assert.match(String(capturedMessages![1].content ?? ""), /用雨夜事故开篇/);
  assert.match(String(capturedMessages![1].content ?? ""), /生成目标章节首稿/);
  assert.equal(
    capturedMessages.filter((message) => message.role === "system").length,
    1,
  );
});

test("ai_novel job scenes use fixed input/output prompts over thinking tool streams", async () => {
  let capturedMessages: Array<{ role: string; content?: string }> | undefined;
  let capturedTools: unknown;
  let completeCalls = 0;
  let streamCalls = 0;
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      completeCalls += 1;
      throw new Error("job scenes should not use non-streaming complete");
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      streamCalls += 1;
      assert.equal(request.providerOptions?.enable_thinking, true);
      assert.equal(request.providerOptions?.tool_choice, "auto");
      capturedMessages = request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      capturedTools = request.providerOptions?.tools;
      const toolName = toolNamesFromProviderOptions(
        request.providerOptions,
      ).find((name) => name.startsWith("submit_"));
      assert.ok(toolName);
      if (toolName) {
        const payload = forcedStructuredToolPayload(toolName);
        yield {
          type: "reasoning_delta",
          text: "整理结构化工作流输出。",
        };
        yield {
          type: "tool_call_delta",
          text: String(
            payload.summary ?? payload.brief ?? payload.snapshot ?? "",
          ),
          toolCallId: `call_${toolName}_fixed_1`,
          toolCallName: toolName,
          toolArgumentPath:
            toolName === "submit_next_chapter_brief"
              ? "brief"
              : toolName === "submit_snapshot"
                ? "snapshot"
                : "summary",
        };
        yield {
          type: "tool_call",
          toolCall: {
            id: `call_${toolName}_fixed_1`,
            name: toolName,
            input: payload,
          },
        };
        yield {
          type: "done",
          finishReason: "tool_calls",
        };
        return;
      }
      yield {
        type: "content_delta",
        text: '{"summary":"雨夜事故引出调查线索"}',
      };
      yield {
        type: "done",
        finishReason: "stop",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const chapterSummaryPayload = {
    scene_key: "chapter_summary",
    context: {
      chapterId: 3,
      sourceTextHash: "hash-3",
      chapterText: "雨夜事故引出调查线索。",
    },
    messages: [
      {
        role: "user",
        content: "summarize fixed input",
      },
    ],
  };
  const encryptedChapterSummaryPayload = encryptAiPayload(
    chapterSummaryPayload,
    aiKey,
  );
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      host: "127.0.0.1:3110",
    },
    body: {
      ...encryptedChapterSummaryPayload,
      localDebugRequestPlaintext: JSON.stringify(chapterSummaryPayload),
    },
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  assert.equal(data.sceneKey, "chapter_summary");
  const completion = (data.completion ?? {}) as Record<string, unknown>;
  assert.equal(completion.sceneRouteKey, "ainovel-lowcost-structured");
  const localDebugLlmRequest = (data.localDebugLlmRequest ?? {}) as Record<
    string,
    unknown
  >;
  const localDebugRequestBody = (localDebugLlmRequest.requestBody ??
    {}) as Record<string, unknown>;
  assert.equal(localDebugLlmRequest.sceneKey, "chapter_summary");
  assert.equal(
    localDebugLlmRequest.sceneRouteKey,
    "ainovel-lowcost-structured",
  );
  assert.equal(
    localDebugRequestBody.sceneRouteKey,
    "ainovel-lowcost-structured",
  );
  assert.equal("modelKey" in localDebugRequestBody, false);
  assert.equal(localDebugRequestBody.stream, true);
  assert.deepEqual(
    (localDebugRequestBody.messages as Array<Record<string, unknown>>).map(
      (message) => message.role,
    ),
    ["system", "user"],
  );
  assert.deepEqual(
    ((capturedTools as Array<Record<string, unknown>> | undefined) ?? []).map(
      (tool) =>
        String(
          (tool.function as Record<string, unknown> | undefined)?.name ?? "",
        ),
    ),
    ["submit_chapter_summary"],
  );
  assert.ok(capturedMessages);
  assert.equal(
    capturedMessages!.filter((message) => message.role === "system").length,
    1,
  );
  assert.match(
    String(capturedMessages![0].content ?? ""),
    /ChapterSummaryGenerationJob/,
  );
  assert.equal(capturedMessages![1].role, "user");
  assert.match(String(capturedMessages![1].content ?? ""), /sourceTextHash/);
  assert.match(
    String(capturedMessages![1].content ?? ""),
    /summarize fixed input/,
  );

  const chapterDraftReviewPayload = {
    scene_key: "chapter_draft_review",
    context: {
      round: "initial",
      draft: {
        title: "雨夜",
        content: "雨夜事故引出调查线索。",
      },
      currentBrief: "检查草稿是否推进新行动。",
    },
    messages: [
      {
        role: "user",
        content: "review fixed input",
      },
    ],
  };
  const chapterDraftReviewResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      host: "127.0.0.1:3110",
    },
    body: {
      ...encryptAiPayload(chapterDraftReviewPayload, aiKey),
      localDebugRequestPlaintext: JSON.stringify(chapterDraftReviewPayload),
    },
  });

  assert.equal(chapterDraftReviewResponse.statusCode, 200);
  const decryptedReview = decryptAiPayload(
    chapterDraftReviewResponse.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decryptedReview.code, "OK");
  const reviewData = (decryptedReview.data ?? {}) as Record<string, unknown>;
  assert.equal(reviewData.sceneKey, "chapter_draft_review");
  const reviewDebugLlmRequest = (reviewData.localDebugLlmRequest ??
    {}) as Record<string, unknown>;
  const reviewDebugRequestBody = (reviewDebugLlmRequest.requestBody ??
    {}) as Record<string, unknown>;
  assert.equal(reviewDebugLlmRequest.sceneKey, "chapter_draft_review");
  assert.equal(
    reviewDebugLlmRequest.sceneRouteKey,
    "ainovel-lowcost-structured",
  );
  assert.equal(
    reviewDebugRequestBody.sceneRouteKey,
    "ainovel-lowcost-structured",
  );
  assert.equal("modelKey" in reviewDebugRequestBody, false);
  assert.equal(reviewDebugRequestBody.stream, true);
  assert.deepEqual(
    (reviewDebugRequestBody.messages as Array<Record<string, unknown>>).map(
      (message) => message.role,
    ),
    ["system", "user"],
  );
  assert.ok(capturedMessages);
  assert.equal(
    capturedMessages!.filter((message) => message.role === "system").length,
    1,
  );
  assert.match(
    String(capturedMessages![0].content ?? ""),
    /ChapterDraftReviewJob/,
  );
  assert.match(String(capturedMessages![1].content ?? ""), /round/);
  assert.match(
    String(capturedMessages![1].content ?? ""),
    /review fixed input/,
  );

  const streamResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        stream: true,
        context: {
          chapterText: "雨夜事故引出调查线索。",
        },
        messages: [
          {
            role: "user",
            content: "summarize fixed input",
          },
        ],
      },
      aiKey,
    ),
  });
  assert.equal(streamResponse.statusCode, 200);
  const streamEvents = await collectSseEvents(streamResponse.streamBody);
  const decryptedStreamEvents = streamEvents
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.deepEqual(
    decryptedStreamEvents.map((event) => event.type),
    ["reasoning_delta", "tool_call_delta", "tool_call", "done"],
  );
  assert.equal(decryptedStreamEvents[1].toolCallName, "submit_chapter_summary");
  assert.equal(decryptedStreamEvents[1].toolArgumentPath, "summary");
  assert.match(String(decryptedStreamEvents[1].text ?? ""), /雨夜事故/);
  assert.doesNotMatch(String(decryptedStreamEvents[1].text ?? ""), /[{}"]/);
  assert.equal(completeCalls, 0);
  assert.equal(streamCalls, 3);
});

test("ai_novel kickoff_turn relays unknown kickoff tool to the client agent", async () => {
  let streamCalls = 0;
  const llmProvider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "{}",
        finishReason: "stop",
        providerRequestId: "chat-req-setup-unknown-tool-001",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      streamCalls += 1;
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_unknown_1",
          name: "invent_new_tool",
          input: {},
        },
      };
      yield {
        type: "done",
        finishReason: "tool_calls",
      };
    },
  };

  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "写一个赛博都市异能故事。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events
    .map((event) => decryptAiPayload(event, aiKey))
    .map(normalizeAiEvent);
  assert.equal(streamCalls, 1);
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["tool_call", "done"],
  );
  const toolCall = decryptedEvents[0].toolCall as Record<string, unknown>;
  assert.equal(toolCall.id, "tool_unknown_1");
  assert.equal(toolCall.name, "invent_new_tool");
  assert.deepEqual(toolCall.input, {});
});

test("ai_novel chat completions route keeps JSON envelope when stream is false", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        stream: false,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, undefined);
  assert.equal(response.streamBody, undefined);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  assert.equal(data.sceneKey, "chapter_summary");
});

test("ai_novel chat completions route rejects non-boolean stream values", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "write_turn",
        stream: "true",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "REQ_INVALID_BODY");
  assert.equal(decrypted.message, "请求内容不合法，请检查后重试。");
});

test("ai_novel chat completions route emits encrypted error event when stream fails mid-flight", async () => {
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield {
        type: "content_delta",
        text: "第八十",
      };
      throw new Error("upstream stream exploded");
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      host: "127.0.0.1:3100",
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "write_turn",
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "text/event-stream; charset=utf-8");
  const events = await collectSseEvents(response.streamBody);
  assert.equal(events.length, 2);

  const decryptedEvents = events.map((event) => decryptAiPayload(event, aiKey));
  assert.equal(
    (
      (decryptedEvents[0]?.data as Record<string, unknown>).type ?? ""
    ).toString(),
    "content_delta",
  );
  assert.equal(decryptedEvents[1]?.code, "SYS_INTERNAL_ERROR");
  assert.equal(decryptedEvents[1]?.message, "系统出现异常，请稍后重试。");
});

test("ai_novel stream errors log upstream and encrypted business error details", async () => {
  const requestId = "req_ai_log_probe";
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("complete should not be called");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      throw new ApplicationError(
        502,
        "LLM_PROVIDER_REQUEST_FAILED",
        "Provider returned 502 Bad Gateway.",
        {
          provider: "bailian",
          statusCode: 502,
          errorCode: "UpstreamBadGateway",
          providerRequestId: "dashscope_req_001",
          reason: "bad_gateway",
        },
      );
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    requestId,
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events.map((event) => decryptAiPayload(event, aiKey));
  assert.equal(decryptedEvents[0]?.code, "AI_UPSTREAM_BAD_GATEWAY");

  const upstreamLog = runtime.logger.records.find(
    (entry) => entry.message === "ai_novel upstream request failed",
  );
  assert.ok(upstreamLog);
  assert.equal(upstreamLog.requestId, requestId);
  assert.equal(upstreamLog.stage, "chat_stream");
  assert.equal(upstreamLog.sceneKey, "kickoff_turn");
  assert.equal(upstreamLog.provider, "bailian");
  assert.equal(upstreamLog.providerStatusCode, 502);
  assert.equal(upstreamLog.providerErrorCode, "UpstreamBadGateway");
  assert.equal(upstreamLog.providerRequestId, "dashscope_req_001");
  assert.equal(upstreamLog.mappedCode, "AI_UPSTREAM_BAD_GATEWAY");

  const encryptedLog = runtime.logger.records.find(
    (entry) => entry.message === "encrypted ai business error",
  );
  assert.ok(
    encryptedLog,
    JSON.stringify(runtime.logger.records.map((entry) => entry.message)),
  );
  assert.equal(encryptedLog.requestId, requestId);
  assert.equal(encryptedLog.path, "/api/v1/ai_novel/ai/chat-completions");
  assert.equal(encryptedLog.transport, "stream");
  assert.equal(encryptedLog.code, "AI_UPSTREAM_BAD_GATEWAY");
  assert.match(String(encryptedLog.detailsPreview), /dashscope_req_001/);
});

test("ai_novel stream logs raw unknown upstream errors before generic wrapping", async () => {
  const requestId = "req_ai_stream_unknown_error_probe";
  const streamError = new Error("stream reader aborted unexpectedly", {
    cause: new Error("socket closed while reading SSE"),
  });
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("stream probe should not use complete");
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: "reasoning_delta", text: "thinking" };
      throw streamError;
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    requestId,
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
      "x-app-locale": "zh-CN",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const events = await collectSseEvents(response.streamBody);
  const decryptedEvents = events.map((event) => decryptAiPayload(event, aiKey));
  assert.equal(decryptedEvents[0]?.code, "OK");
  assert.equal(decryptedEvents[1]?.code, "SYS_INTERNAL_ERROR");

  const upstreamLog = runtime.logger.records.find(
    (entry) => entry.message === "ai_novel upstream request failed",
  );
  assert.ok(upstreamLog);
  assert.equal(upstreamLog.requestId, requestId);
  assert.equal(upstreamLog.stage, "chat_stream");
  assert.equal(upstreamLog.originalName, "Error");
  assert.equal(upstreamLog.originalMessage, "stream reader aborted unexpectedly");
  assert.match(
    String(upstreamLog.originalStack),
    /stream reader aborted unexpectedly/,
  );
  assert.match(
    String(upstreamLog.originalCausePreview),
    /socket closed while reading SSE/,
  );

  const unexpectedLog = runtime.logger.records.find(
    (entry) => entry.message === "encrypted ai stream unexpected error",
  );
  assert.ok(unexpectedLog);
  assert.equal(unexpectedLog.requestId, requestId);
  assert.equal(unexpectedLog.errorName, "Error");
  assert.equal(unexpectedLog.errorMessage, "stream reader aborted unexpectedly");
  assert.match(
    String(unexpectedLog.errorStack),
    /stream reader aborted unexpectedly/,
  );
  assert.match(
    String(unexpectedLog.errorCausePreview),
    /socket closed while reading SSE/,
  );
});

test("ai_novel upstream auth failures return refined code with local debug details", async () => {
  const requestId = "req_ai_auth_debug_probe";
  const llmProvider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new ApplicationError(
        502,
        "LLM_PROVIDER_REQUEST_FAILED",
        "Incorrect API key provided.",
        {
          provider: "bailian",
          statusCode: 401,
          errorCode: "invalid_api_key",
          errorType: "invalid_request_error",
          providerRequestId: "dashscope_auth_req_001",
        },
      );
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      throw new Error("stream should not be called");
    },
  };
  const { runtime, aiKey } = await createAiNovelRuntime({ llmProvider });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const previousAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = "dev";
  let response: Awaited<ReturnType<typeof runtime.app.handle>> | undefined;
  try {
    response = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/ai/chat-completions",
      requestId,
      headers: {
        authorization: `Bearer ${token}`,
        "X-App-Id": "ai_novel",
        "x-app-locale": "zh-CN",
      },
      body: encryptAiPayload(
        {
          scene_key: "chat_compaction",
          messages: [
            {
              role: "user",
              content: "hello",
            },
          ],
        },
        aiKey,
      ),
    });
  } finally {
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousAppEnv;
    }
  }

  assert.ok(response);
  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "AI_UPSTREAM_AUTH_FAILED");
  assert.equal(decrypted.message, "AI 服务暂不可用，请稍后重试。");
  const data = decrypted.data as Record<string, unknown>;
  assert.equal(data.provider, "bailian");
  assert.equal(data.providerStatusCode, 401);
  assert.equal(data.providerErrorCode, "invalid_api_key");
  assert.equal(data.providerErrorType, "invalid_request_error");
  assert.equal(data.providerRequestId, "dashscope_auth_req_001");
  assert.match(String(data.detailsPreview), /dashscope_auth_req_001/);

  const upstreamLog = runtime.logger.records.find(
    (entry) => entry.message === "ai_novel upstream request failed",
  );
  assert.ok(upstreamLog);
  assert.equal(upstreamLog.requestId, requestId);
  assert.equal(upstreamLog.mappedCode, "AI_UPSTREAM_AUTH_FAILED");
  assert.equal(upstreamLog.providerErrorCode, "invalid_api_key");
});

test("ai_novel embeddings route resolves scene_key to embedding scene route selection", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/embeddings",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "summary_embed",
        input: ["第一段摘要", "第二段摘要"],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  assert.equal(data.sceneKey, "summary_embed");
  assert.equal(data.sceneRouteKey, "ainovel-embedding-default");
  assert.equal(data.provider, "bailian");
  assert.equal(data.providerModel, "text-embedding-v4");
  assert.equal(data.providerRequestId, "emb-req-001");
  assert.equal(((data.vectors ?? []) as unknown[]).length, 2);
});

test("ai_novel routes return encrypted business errors after request decryption", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  for (const forbiddenField of [
    "model",
    "modelKey",
    "providerModel",
    "tier",
    "routingTier",
    "modelTier",
  ]) {
    const invalidModelResponse = await runtime.app.handle({
      method: "POST",
      path: "/api/v1/ai_novel/ai/chat-completions",
      headers: {
        authorization: `Bearer ${token}`,
        "X-App-Id": "ai_novel",
      },
      body: encryptAiPayload(
        {
          scene_key: "chapter_summary",
          [forbiddenField]: "glm-5",
          messages: [
            {
              role: "user",
              content: "hello",
            },
          ],
        },
        aiKey,
      ),
    });

    assert.equal(invalidModelResponse.statusCode, 200);
    assert.equal(
      decryptAiPayload(
        invalidModelResponse.body as Record<string, unknown>,
        aiKey,
      ).code,
      "REQ_INVALID_BODY",
    );
  }

  const conflictingSceneResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        sceneKey: "next_chapter_brief",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(conflictingSceneResponse.statusCode, 200);
  assert.equal(
    decryptAiPayload(
      conflictingSceneResponse.body as Record<string, unknown>,
      aiKey,
    ).code,
    "REQ_INVALID_BODY",
  );

  const unsupportedTaskResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/embeddings",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "unknown_embed",
        input: ["hello"],
      },
      aiKey,
    ),
  });

  assert.equal(unsupportedTaskResponse.statusCode, 200);
  assert.equal(
    decryptAiPayload(
      unsupportedTaskResponse.body as Record<string, unknown>,
      aiKey,
    ).code,
    "AI_SCENE_NOT_SUPPORTED",
  );
});

test("ai_novel routes enforce app scope when bearer auth is present", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "app_a",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});

test("ai_novel routes reject unknown encryption keys before entering AI flow", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const body = encryptAiPayload(
    {
      scene_key: "chapter_summary",
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
    },
    aiKey,
  );
  body.keyId = "logk_unknown";

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "AI_UNKNOWN_KEY_ID");
});

test("ai_novel routes ignore admin scene routing overrides", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const config =
    runtime.services.appAiRoutingConfigService.createDefaultConfig();
  config.scenes.chapter_summary.routes.free = "ainovel-plus-creative";
  await runtime.services.appConfigService.setValue(
    "ai_novel",
    AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    JSON.stringify(config),
    "test-override",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  const data = (decrypted.data ?? {}) as Record<string, unknown>;
  const completion = (data.completion ?? {}) as Record<string, unknown>;
  assert.equal(completion.sceneRouteKey, "ainovel-lowcost-structured");
  assert.equal(completion.providerModel, "qwen3.6-plus");
});

test("ai_novel runtime ignores stale admin routing config", async () => {
  const { runtime } = await createAiNovelRuntime();
  await runtime.services.appConfigService.setValue(
    "ai_novel",
    AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    JSON.stringify(
      {
        defaultTier: "free",
        tiers: {
          free: {
            chat: {
              kickoff_turn: "legacy-admin-route",
            },
            embedding: {},
          },
        },
      },
      null,
      2,
    ),
    "test-stale-route",
  );

  const config =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  assert.equal(
    config.scenes.kickoff_turn?.routes.free,
    "ainovel-plus-reasoning",
  );
});

test("ai_novel routes ignore missing admin route mapping", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const currentConfig =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  delete (currentConfig.scenes.chapter_summary.routes as Record<string, string>)
    .free;
  await runtime.services.appConfigService.setValue(
    "ai_novel",
    AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    JSON.stringify(currentConfig, null, 2),
    "test-missing-route",
  );

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(decrypted.code, "OK");
});

test("ai_novel chat completions rejects keyword-sensitive user input before LLM", async () => {
  let llmCallCount = 0;
  const { runtime, aiKey } = await createAiNovelRuntime({
    llmProvider: {
      async complete(request): Promise<LLMCompletionResult> {
        llmCallCount += 1;
        return {
          provider: request.model.provider,
          modelKey: request.model.modelKey,
          providerModel: request.model.providerModel,
          text: "should not run",
        };
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        llmCallCount += 1;
        yield { type: "done" };
      },
    },
  });
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  await runtime.services.commonContentSafetyConfigService.updateConfig({
    enabled: true,
    longTextThresholdChars: 2000,
    keyword: {
      enabled: true,
      rules: [
        {
          id: "blocked_1",
          term: "不该发送",
          enabled: true,
          category: "test",
        },
      ],
    },
    llm: {
      enabled: true,
      modelKey: "qwen3.5-flash",
      timeoutMs: 1000,
    },
    aliyun: {
      enabled: false,
      endpoint: "https://green-cip.cn-shanghai.aliyuncs.com",
      region: "cn-shanghai",
      service: "chat_detection",
      accessKeyIdPasswordKey: "",
      accessKeySecretPasswordKey: "",
      timeoutMs: 1000,
    },
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "accept-language": "zh-CN",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "chapter_summary",
        messages: [
          {
            role: "user",
            content: "这段不该发送的内容",
          },
        ],
      },
      aiKey,
    ),
  });

  const decrypted = decryptAiPayload(
    response.body as Record<string, unknown>,
    aiKey,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(decrypted.code, "AI_INPUT_CONTENT_SENSITIVE");
  assert.equal(decrypted.message, "这段内容暂时无法发送，请调整后再试。");
  assert.equal(llmCallCount, 0);
  assert.deepEqual(decrypted.data, null);
});

test("ai_novel streamed chat returns sensitive error event for blocked input", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  await runtime.services.commonContentSafetyConfigService.updateConfig({
    enabled: true,
    longTextThresholdChars: 2000,
    keyword: {
      enabled: true,
      rules: [
        {
          id: "blocked_2",
          term: "禁止发送",
          enabled: true,
          category: "test",
        },
      ],
    },
    llm: {
      enabled: true,
      modelKey: "qwen3.5-flash",
      timeoutMs: 1000,
    },
    aliyun: {
      enabled: false,
      endpoint: "https://green-cip.cn-shanghai.aliyuncs.com",
      region: "cn-shanghai",
      service: "chat_detection",
      accessKeyIdPasswordKey: "",
      accessKeySecretPasswordKey: "",
      timeoutMs: 1000,
    },
  });

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "accept-language": "zh-CN",
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        scene_key: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            titleCandidate: "",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "禁止发送" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  const decrypted = decryptAiPayload(events[0], aiKey);
  assert.equal(response.statusCode, 200);
  assert.equal(decrypted.code, "AI_INPUT_CONTENT_SENSITIVE");
  assert.equal(decrypted.message, "这段内容暂时无法发送，请调整后再试。");
  assert.equal(decrypted.data, null);
});
