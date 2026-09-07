import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../src/shared/errors.ts";
import {
  isRetryableAiNovelStreamError,
  streamWithAiNovelModelRetry,
} from "../../src/modules/ai-novel/ai-novel-stream-retry.ts";
import { AiNovelLlmService } from "../../src/modules/ai-novel/ai-novel-llm.service.ts";
import { AiNovelConversationRecordService } from "../../src/modules/ai-novel/ai-novel-conversation-record.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

test("AINovel stream retries once with an excluded model before the first chunk", async () => {
  const selectedModels: string[] = [];
  const result = await collect(
    streamWithAiNovelModelRetry({
      resolveModelKey: async (excluded) => {
        const modelKey = excluded.has("model-a") ? "model-b" : "model-a";
        selectedModels.push(modelKey);
        return modelKey;
      },
      run: async function* (modelKey) {
        if (modelKey === "model-a") {
          throw new ApplicationError(503, "LLM_PROVIDER_REQUEST_FAILED", "timeout", {
            reason: "timeout",
          });
        }
        yield "model-b-result";
      },
      shouldRetry: isRetryableAiNovelStreamError,
    }),
  );

  assert.deepEqual(selectedModels, ["model-a", "model-b"]);
  assert.deepEqual(result, ["model-b-result"]);
});

test("AINovel stream never retries after yielding a chunk", async () => {
  const selectedModels: string[] = [];

  await assert.rejects(
    () => collect(
      streamWithAiNovelModelRetry({
        resolveModelKey: async () => {
          selectedModels.push("model-a");
          return "model-a";
        },
        run: async function* () {
          yield "partial";
          throw new ApplicationError(503, "LLM_PROVIDER_REQUEST_FAILED", "timeout", {
            reason: "stream_idle_timeout",
          });
        },
        shouldRetry: isRetryableAiNovelStreamError,
      }),
    ),
    /timeout/,
  );

  assert.deepEqual(selectedModels, ["model-a"]);
});

test("AINovel stream treats an already yielded debug chunk as committed output", async () => {
  let attempts = 0;

  await assert.rejects(
    () => collect(
      streamWithAiNovelModelRetry({
        initiallyYielded: true,
        resolveModelKey: async () => {
          attempts += 1;
          return "model-a";
        },
        run: async function* () {
          throw new ApplicationError(503, "LLM_PROVIDER_REQUEST_FAILED", "timeout", {
            reason: "timeout",
          });
        },
        shouldRetry: isRetryableAiNovelStreamError,
      }),
    ),
    /timeout/,
  );

  assert.equal(attempts, 1);
});

test("AINovel stream retry has a hard two-attempt limit", async () => {
  const selectedModels: string[] = [];

  await assert.rejects(
    () => collect(
      streamWithAiNovelModelRetry({
        resolveModelKey: async (excluded) => {
          const modelKey = excluded.has("model-a") ? "model-b" : "model-a";
          selectedModels.push(modelKey);
          return modelKey;
        },
        run: async function* () {
          throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", "bad response");
        },
        shouldRetry: isRetryableAiNovelStreamError,
      }),
    ),
    /bad response/,
  );

  assert.deepEqual(selectedModels, ["model-a", "model-b"]);
});

test("AINovel stream preserves the first upstream error when no alternate model remains", async () => {
  let selections = 0;
  const firstError = new ApplicationError(
    502,
    "LLM_PROVIDER_REQUEST_FAILED",
    "provider unavailable",
    { reason: "network_error" },
  );

  await assert.rejects(
    () => collect(
      streamWithAiNovelModelRetry({
        resolveModelKey: async (excluded) => {
          selections += 1;
          if (excluded.has("model-a")) {
            throw new ApplicationError(
              503,
              "AI_MODEL_NOT_AVAILABLE",
              "no alternate model",
            );
          }
          return "model-a";
        },
        run: async function* () {
          throw firstError;
        },
        shouldRetry: isRetryableAiNovelStreamError,
      }),
    ),
    (error: unknown) => error === firstError,
  );

  assert.equal(selections, 2);
});

test("AINovel stream does not retry non-upstream validation failures", async () => {
  let attempts = 0;

  await assert.rejects(
    () => collect(
      streamWithAiNovelModelRetry({
        resolveModelKey: async () => {
          attempts += 1;
          return "model-a";
        },
        run: async function* () {
          throw new ApplicationError(400, "LLM_PROVIDER_CONTENT_SENSITIVE", "blocked");
        },
        shouldRetry: isRetryableAiNovelStreamError,
      }),
    ),
    /blocked/,
  );

  assert.equal(attempts, 1);
});

test("AINovel stream service excludes the failed model on a pre-chunk retry", async () => {
  const modelCalls: string[] = [];
  const excludedSets: string[] = [];
  const conversationRecords = new AiNovelConversationRecordService(
    new InMemoryDatabase(),
  );
  const service = new AiNovelLlmService(
    {
      stream: async function* ({ modelKey }: { modelKey: string }) {
        modelCalls.push(modelKey);
        if (modelKey === "model-a") {
          throw new ApplicationError(503, "LLM_PROVIDER_REQUEST_FAILED", "timeout", {
            reason: "timeout",
          });
        }
        yield { type: "content_delta", text: "ok" };
        yield { type: "done", finishReason: "stop" };
      },
    } as never,
    {} as never,
    {
      resolveChatModelKey: async (
        _identity: unknown,
        options?: { excludedModelKeys?: ReadonlySet<string> },
      ) => {
        const excluded = options?.excludedModelKeys ?? new Set<string>();
        excludedSets.push([...excluded].join(","));
        return excluded.has("model-a") ? "model-b" : "model-a";
      },
    } as never,
    undefined,
    undefined,
    conversationRecords,
  );

  const chunks = await collect(
    service.createChatCompletionStream(
      {
        sceneKey: "kickoff_turn",
        context: { meta: { language: "zh-CN" } },
        messages: [{ role: "user", content: "继续" }],
      },
      {
        requestId: "stream_request_1",
        userId: "uid_xyz",
        routingIdentity: { did: "did_abc", uid: "uid_xyz" },
      },
    ),
  );

  assert.deepEqual(modelCalls, ["model-a", "model-b"]);
  assert.deepEqual(excludedSets, ["", "model-a"]);
  assert.deepEqual(chunks, [
    { type: "content_delta", text: "ok" },
    {
      type: "done",
      completion: {
        sceneRouteKey: "kickoff_turn",
        content: "ok",
        finishReason: "stop",
      },
    },
  ]);
  const document = await conversationRecords.listForAdmin({ uid: "uid_xyz" });
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0]?.userText, "继续");
  assert.equal(document.items[0]?.assistantText, "ok");
  assert.equal(document.items[0]?.did, "did_abc");
});

test("AINovel non-stream completion records only the latest user text and final assistant text", async () => {
  const conversationRecords = new AiNovelConversationRecordService(
    new InMemoryDatabase(),
  );
  const service = new AiNovelLlmService(
    {
      async complete() {
        return {
          provider: "test",
          modelKey: "model-a",
          providerModel: "upstream-a",
          text: "最终回复",
        };
      },
    } as never,
    {} as never,
    { resolveChatModelKey: async () => "model-a" } as never,
    undefined,
    undefined,
    conversationRecords,
  );

  await service.createChatCompletion(
    {
      sceneKey: "chat_compaction",
      messages: [
        { role: "system", content: "不要保存我" },
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回复" },
        { role: "user", content: "最新问题" },
      ],
    },
    {
      requestId: "complete_request_1",
      userId: "uid_complete",
      routingIdentity: { did: "did_complete", uid: "uid_complete" },
    },
  );

  const document = await conversationRecords.listForAdmin({ did: "did_complete" });
  assert.equal(document.items.length, 1);
  assert.equal(document.items[0]?.userText, "最新问题");
  assert.equal(document.items[0]?.assistantText, "最终回复");
});
