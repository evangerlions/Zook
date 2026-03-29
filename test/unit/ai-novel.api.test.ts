import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import type { EmbeddingProvider, EmbeddingResult } from "../../src/services/embedding-manager.ts";
import type { LLMCompletionResult, LLMProvider, LLMStreamEvent } from "../../src/services/llm-manager.ts";

async function createAiNovelRuntime() {
  const llmProvider: LLMProvider = {
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
        type: "done",
      };
    },
  };

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
  });

  await runtime.services.commonLlmConfigService.updateConfig({
    enabled: true,
    defaultModelKey: "novel-creative",
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
        key: "novel-creative",
        label: "Novel Creative",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "novel-reasoning",
        label: "Novel Reasoning",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "novel-structured",
        label: "Novel Structured",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: 100,
          },
        ],
      },
      {
        key: "novel-embedding",
        label: "Novel Embedding",
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

  return runtime;
}

test("ai_novel chat completions route resolves taskType to scene model selection", async () => {
  const runtime = await createAiNovelRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      "X-App-Id": "ai_novel",
    },
    body: {
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
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.taskType, "continue_chapter");
  assert.equal(response.body.data.completion.modelKey, "novel-creative");
  assert.equal(response.body.data.completion.providerModel, "kimi/kimi-k2.5");
  assert.equal(response.body.data.completion.providerRequestId, "chat-req-001");
});

test("ai_novel embeddings route resolves taskType to embedding model selection", async () => {
  const runtime = await createAiNovelRuntime();

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/embeddings",
    headers: {
      "X-App-Id": "ai_novel",
    },
    body: {
      taskType: "summary_embed",
      input: [
        "第一段摘要",
        "第二段摘要",
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.taskType, "summary_embed");
  assert.equal(response.body.data.modelKey, "novel-embedding");
  assert.equal(response.body.data.providerModel, "text-embedding-v4");
  assert.equal(response.body.data.providerRequestId, "emb-req-001");
  assert.equal(response.body.data.vectors.length, 2);
});

test("ai_novel routes reject direct model overrides and unsupported task types", async () => {
  const runtime = await createAiNovelRuntime();

  const invalidModelResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      "X-App-Id": "ai_novel",
    },
    body: {
      taskType: "continue_chapter",
      model: "glm-5",
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
    },
  });

  assert.equal(invalidModelResponse.statusCode, 400);
  assert.equal(invalidModelResponse.body.code, "REQ_INVALID_BODY");

  const unsupportedTaskResponse = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/embeddings",
    headers: {
      "X-App-Id": "ai_novel",
    },
    body: {
      taskType: "unknown_embed",
      input: ["hello"],
    },
  });

  assert.equal(unsupportedTaskResponse.statusCode, 400);
  assert.equal(unsupportedTaskResponse.body.code, "AI_TASK_TYPE_NOT_SUPPORTED");
});

test("ai_novel routes enforce app scope when bearer auth is present", async () => {
  const runtime = await createAiNovelRuntime();
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "app_a");

  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/ai_novel/ai/chat-completions",
    headers: {
      authorization: `Bearer ${token}`,
      "X-App-Id": "ai_novel",
    },
    body: {
      taskType: "continue_chapter",
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "AUTH_APP_SCOPE_MISMATCH");
});
