import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../src/shared/errors.ts";
import {
  isRetryableAiNovelStreamError,
  streamWithAiNovelModelRetry,
} from "../../src/modules/ai-novel/ai-novel-stream-retry.ts";
import { AiNovelLlmService } from "../../src/modules/ai-novel/ai-novel-llm.service.ts";

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
  );

  const chunks = await collect(
    service.createChatCompletionStream(
      {
        sceneKey: "kickoff_turn",
        context: { meta: { language: "zh-CN" } },
        messages: [{ role: "user", content: "继续" }],
      },
      { routingIdentity: { did: "did_abc", uid: "uid_xyz" } },
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
});
