import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import type {
  EmbeddingProvider,
  EmbeddingResult,
} from "../../src/services/embedding-manager.ts";
import type {
  LLMCompletionResult,
  LLMProvider,
  LLMStreamEvent,
} from "../../src/services/llm-manager.ts";
import { AI_NOVEL_MODEL_ROUTING_CONFIG_KEY } from "../../src/services/app-ai-routing-config.service.ts";

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

function normalizeAiEvent(event: Record<string, unknown>): Record<string, unknown> {
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
    async *stream(): AsyncIterable<LLMStreamEvent> {
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
        key: "ainovel-free-creative",
        label: "AINovel Free Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "qwen-plus",
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
            providerModel: "qwen3.5-flash",
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
            providerModel: "siliconflow/deepseek-v3.2",
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
            providerModel: "qwen3.5-plus",
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
            providerModel: "minimax-m2.7",
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
            providerModel: "glm-5",
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
            providerModel: "qwen3.5-flash",
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
        taskType: "continue_chapter",
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

test("ai_novel chat completions route resolves taskType to scene model selection", async () => {
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
        taskType: "continue_chapter",
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
  assert.equal(data.taskType, "continue_chapter");
  const completion = (data.completion ?? {}) as Record<string, unknown>;
  assert.equal(completion.modelKey, "ainovel-free-creative");
  assert.equal(completion.provider, "bailian");
  assert.equal(completion.providerModel, "qwen-plus");
  assert.equal(completion.providerRequestId, "chat-req-001");
  assert.equal(
    (response.body as Record<string, unknown>).localDebugResponseText,
    "第八十一回……",
  );
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
        taskType: "continue_chapter",
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
  const doneCompletion = ((decryptedEvents[3]?.data as Record<string, unknown>)
    .completion ?? {}) as Record<string, unknown>;
  assert.equal(doneCompletion.modelKey, "ainovel-free-creative");
  assert.equal(doneCompletion.content, "第八十一回……");
  assert.equal(doneCompletion.provider, undefined);
  assert.equal(doneCompletion.providerModel, undefined);
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
            title: "赛博夜行档案",
            logline: "被公司流放的异能调查员，在霓虹深城里追查记忆走私案。",
            readiness: 0.2,
          },
        },
      };
      yield {
        type: "tool_call",
        toolCall: {
          id: "tool_ready_1",
          name: "ready",
          input: {},
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
            readiness: 0,
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
    "text_delta",
    "tool_call",
    "tool_call",
    "usage",
    "done",
  ]);

  const updateMeta = decryptedEvents[1].toolCall as Record<string, unknown>;
  assert.equal(updateMeta.name, "update_meta");
  assert.equal(((updateMeta.input as Record<string, unknown>).title ?? '').toString(), "赛博夜行档案");
  assert.equal(((updateMeta.input as Record<string, unknown>).readiness ?? 0), 0.2);
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
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

test("ai_novel kickoff_turn builds one merged system message with workflow prompt and summary", async () => {
  let capturedMessages: Array<{ role: string; content?: string }> | undefined;
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "AI 正在为这本书起名",
            logline: "校园超自然故事，从一个异常事件开始。",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "写一个校园超自然故事，从一个异常事件开始。" }],
      },
      aiKey,
    ),
  });

  const events = await collectSseEvents(response.streamBody);
  assert.ok(events.length > 0);
  assert.ok(capturedMessages);

  const systemMessages = capturedMessages!.filter((message) => message.role === "system");
  assert.equal(systemMessages.length, 1);
  assert.match(String(systemMessages[0]?.content ?? ""), /## Role/);
  assert.match(String(systemMessages[0]?.content ?? ""), /## Workflow discipline/);
  assert.match(String(systemMessages[0]?.content ?? ""), /may call multiple tools/i);
  assert.match(String(systemMessages[0]?.content ?? ""), /In most turns, continue by asking the next focused question/i);
  assert.match(String(systemMessages[0]?.content ?? ""), /Current kickoff summary:/);
  assert.match(String(systemMessages[0]?.content ?? ""), /- title: AI 正在为这本书起名/);
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "烬骨长明",
            logline: "被逐出宗门的天才少年踏上翻案之路。",
            protagonistAndHook: "林烬被栽赃逐出宗门后得到古老器灵。",
            storyDirection: "从边荒求生开始翻案。",
            scale: "长篇",
            readiness: 0.1,
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
  assert.equal(((decryptedEvents[0].toolCall as Record<string, unknown>).name ?? '').toString(), "read_meta");
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
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
    ["text_delta", "done"],
  );
  const doneCompletion = (decryptedEvents[1]?.completion ?? {}) as Record<string, unknown>;
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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
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
    ["reasoning_delta", "text_delta", "done"],
  );
  assert.equal(decryptedEvents[0].text, "先确认故事驱动力");
});

test("ai_novel kickoff_turn unknown kickoff tool emits encrypted error event", async () => {
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
    },
    body: encryptAiPayload(
      {
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
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
  assert.deepEqual(
    decryptedEvents.map((event) => event.type),
    ["error", "done"],
  );
  const errorPayload = decryptedEvents[0].payload as Record<string, unknown>;
  assert.equal(errorPayload.code, "KICKOFF_TOOL_UNKNOWN");
  assert.equal(errorPayload.recoverable, false);
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
    },
    body: encryptAiPayload(
      {
        taskType: "continue_chapter",
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
  assert.equal(data.taskType, "continue_chapter");
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
    },
    body: encryptAiPayload(
      {
        taskType: "continue_chapter",
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
  assert.equal(decrypted.message, "stream must be a boolean when provided.");
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
    },
    body: encryptAiPayload(
      {
        taskType: "continue_chapter",
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
  assert.equal(
    decryptedEvents[1]?.message,
    "An unexpected internal error occurred.",
  );
});

test("ai_novel embeddings route resolves taskType to embedding model selection", async () => {
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
        taskType: "summary_embed",
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
  assert.equal(data.taskType, "summary_embed");
  assert.equal(data.modelKey, "ainovel-embedding-default");
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

  const invalidModelResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        taskType: "continue_chapter",
        model: "glm-5",
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

  const unsupportedTaskResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/embeddings",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: encryptAiPayload(
      {
        taskType: "unknown_embed",
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
    "AI_TASK_TYPE_NOT_SUPPORTED",
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
        taskType: "continue_chapter",
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
      taskType: "continue_chapter",
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

test("ai_novel routes can override model routing from admin config", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  await runtime.services.appAiRoutingConfigService.updateConfig(
    "ai_novel",
    JSON.stringify({
      defaultTier: "free",
      tiers: {
        free: {
          chat: {
            kickoff_turn: "ainovel-plus-reasoning",
            blueprint_gen: "ainovel-plus-creative",
            chapter1_draft_gen: "ainovel-plus-creative",
            chapter1_critic: "ainovel-plus-reasoning",
            fact_extract: "ainovel-lowcost-structured",
            episode_extract: "ainovel-lowcost-structured",
            continue_chapter: "ainovel-plus-creative",
            chapter_transition: "ainovel-plus-reasoning",
            chapter2_planner: "ainovel-plus-reasoning",
            chapter2_draft_gen: "ainovel-plus-creative",
          },
          embedding: {
            fact_embed: "ainovel-embedding-default",
            episode_embed: "ainovel-embedding-default",
            summary_embed: "ainovel-embedding-default",
            query_memory_embed: "ainovel-embedding-default",
          },
        },
        plus: {
          chat: {
            kickoff_turn: "ainovel-plus-reasoning",
            blueprint_gen: "ainovel-plus-creative",
            chapter1_draft_gen: "ainovel-plus-creative",
            chapter1_critic: "ainovel-plus-reasoning",
            fact_extract: "ainovel-lowcost-structured",
            episode_extract: "ainovel-lowcost-structured",
            continue_chapter: "ainovel-plus-creative",
            chapter_transition: "ainovel-plus-reasoning",
            chapter2_planner: "ainovel-plus-reasoning",
            chapter2_draft_gen: "ainovel-plus-creative",
          },
          embedding: {
            fact_embed: "ainovel-embedding-default",
            episode_embed: "ainovel-embedding-default",
            summary_embed: "ainovel-embedding-default",
            query_memory_embed: "ainovel-embedding-default",
          },
        },
        super_plus: {
          chat: {
            kickoff_turn: "ainovel-super-reasoning",
            blueprint_gen: "ainovel-super-creative",
            chapter1_draft_gen: "ainovel-super-creative",
            chapter1_critic: "ainovel-super-reasoning",
            fact_extract: "ainovel-lowcost-structured",
            episode_extract: "ainovel-lowcost-structured",
            continue_chapter: "ainovel-super-creative",
            chapter_transition: "ainovel-super-reasoning",
            chapter2_planner: "ainovel-super-reasoning",
            chapter2_draft_gen: "ainovel-super-creative",
          },
          embedding: {
            fact_embed: "ainovel-embedding-default",
            episode_embed: "ainovel-embedding-default",
            summary_embed: "ainovel-embedding-default",
            query_memory_embed: "ainovel-embedding-default",
          },
        },
      },
    }),
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
        taskType: "continue_chapter",
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
  assert.equal(completion.modelKey, "ainovel-plus-creative");
  assert.equal(completion.providerModel, "siliconflow/deepseek-v3.2");
});

test("ai_novel routes normalize legacy setup_turn routing configs on read", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );

  const currentConfig =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  const legacyConfig = structuredClone(currentConfig);
  for (const tier of Object.values(legacyConfig.tiers)) {
    tier.chat.setup_turn = tier.chat.kickoff_turn;
    delete tier.chat.kickoff_turn;
  }

  await runtime.services.appConfigService.setValue(
    "ai_novel",
    AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    JSON.stringify(legacyConfig, null, 2),
    "test-legacy-setup-turn",
  );

  const normalized =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  assert.equal(normalized.tiers.free.chat.kickoff_turn, "ainovel-plus-reasoning");

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
        taskType: "kickoff_turn",
        stream: true,
        context: {
          meta: {
            title: "",
            logline: "",
            protagonistAndHook: "",
            storyDirection: "",
            scale: "待定",
            readiness: 0,
          },
        },
        messages: [{ role: "user", content: "继续推进这个故事。" }],
      },
      aiKey,
    ),
  });

  assert.equal(response.statusCode, 200);
});

test("ai_novel routes fail when routing mapping is missing", async () => {
  const { runtime, aiKey } = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken(
    "user_alice",
    "ai_novel",
  );
  const currentConfig =
    await runtime.services.appAiRoutingConfigService.getCurrentConfig(
      "ai_novel",
    );
  delete currentConfig.tiers.free.chat.continue_chapter;
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
        taskType: "continue_chapter",
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
  assert.equal(
    decryptAiPayload(response.body as Record<string, unknown>, aiKey).code,
    "AI_UPSTREAM_BAD_GATEWAY",
  );
});
