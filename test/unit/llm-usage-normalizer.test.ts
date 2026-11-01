import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlmUsage } from "../../src/services/llm-usage-normalizer.ts";
import { parseOpenAICompatibleChatUsage, parseOpenAICompatibleEmbeddingUsage } from "../../src/services/openai-compatible-usage.ts";
import { LLMManager, type LLMProvider, type LLMUsage } from "../../src/services/llm-manager.ts";
import { EmbeddingManager } from "../../src/services/embedding-manager.ts";
import type { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";

const valid = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };

test("usage preserves authoritative cache and reasoning subsets, including real zero", () => {
  assert.deepEqual(normalizeLlmUsage({ ...valid, cachedInputTokens: 60, reasoningTokens: 10 }), {
    ...valid, cachedInputTokens: 60, reasoningTokens: 10,
  });
  assert.deepEqual(normalizeLlmUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }), {
    promptTokens: 0, completionTokens: 0, totalTokens: 0,
  });
  assert.equal(normalizeLlmUsage(valid)?.cachedInputTokens, undefined);
});

test("usage rejects unsafe counts, inconsistent totals and impossible subsets", () => {
  for (const field of ["promptTokens", "completionTokens", "totalTokens", "reasoningTokens", "cachedInputTokens"]) {
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
      assert.equal(normalizeLlmUsage({ ...valid, [field]: value } as LLMUsage), undefined, `${field}=${value}`);
    }
  }
  assert.equal(normalizeLlmUsage({ ...valid, totalTokens: 121 }), undefined);
  assert.equal(normalizeLlmUsage({ ...valid, cachedInputTokens: 101 }), undefined);
  assert.equal(normalizeLlmUsage({ ...valid, reasoningTokens: 21 }), undefined);
  assert.equal(normalizeLlmUsage(undefined), undefined);
});

test("compatible adapter reads cache-read detail without counting it twice", () => {
  assert.deepEqual(parseOpenAICompatibleChatUsage({
    prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 60 },
    completion_tokens_details: { reasoning_tokens: 10 },
  }, "test"), { ...valid, cachedInputTokens: 60, reasoningTokens: 10 });
  assert.equal(parseOpenAICompatibleChatUsage({ prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 }, "test"), undefined);
  assert.equal(parseOpenAICompatibleChatUsage({ prompt_tokens: 100 }, "test"), undefined);
  assert.deepEqual(parseOpenAICompatibleEmbeddingUsage({ prompt_tokens: 100, total_tokens: 100 }, "test"), {
    promptTokens: 100, completionTokens: 0, totalTokens: 100,
  });
  assert.equal(parseOpenAICompatibleEmbeddingUsage({ prompt_tokens: 1, total_tokens: 1, completion_tokens: -1 }, "test"), undefined);
});

function manager(usage: LLMUsage): LLMManager {
  const provider: LLMProvider = {
    async complete() {
      return { provider: "test", modelKey: "test", providerModel: "test", text: "已完成", usage };
    },
    async *stream() {
      yield { type: "content_delta", text: "已完成" };
      yield { type: "usage", usage };
      yield { type: "done", finishReason: "stop" };
    },
  };
  return new LLMManager({ test: provider }, { test: { provider: "test", providerModel: "test" } });
}

const request = { modelKey: "test", messages: [{ role: "user" as const, content: "写一章" }] };

test("invalid vendor metadata cannot discard generated text and all chat paths use fallback", async () => {
  const llm = manager({ ...valid, promptTokens: -1 });
  for (const result of [await llm.complete(request), await llm.completeViaStream(request)]) {
    assert.equal(result.text, "已完成");
    assert.equal(result.usage?.estimated, true);
    assert.ok(result.usage!.promptTokens > 0);
  }
  const events = [];
  for await (const event of llm.stream(request)) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["content_delta", "usage", "done"]);
  const usage = events.find((event) => event.type === "usage");
  assert.equal(usage?.type === "usage" && usage.usage.estimated, true);
});

test("valid vendor cache usage is preferred over estimates through all chat paths", async () => {
  const llm = manager({ ...valid, cachedInputTokens: 60 });
  for (const result of [await llm.complete(request), await llm.completeViaStream(request)]) {
    assert.equal(result.usage?.promptTokens, 100);
    assert.equal(result.usage?.cachedInputTokens, 60);
    assert.equal(result.usage?.estimated, undefined);
  }
});

test("later invalid usage cannot overwrite authoritative counters in either stream path", async () => {
  const provider: LLMProvider = {
    async complete() { throw new Error("not used"); },
    async *stream() {
      yield { type: "content_delta", text: "已完成" };
      yield { type: "usage", usage: { ...valid, cachedInputTokens: 60 } };
      yield { type: "usage", usage: { ...valid, promptTokens: -1 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const llm = new LLMManager({ test: provider }, { test: { provider: "test", providerModel: "test" } });
  const result = await llm.completeViaStream(request);
  assert.equal(result.usage?.cachedInputTokens, 60);
  assert.equal(result.usage?.promptTokens, 100);
  const events = [];
  for await (const event of llm.stream(request)) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["content_delta", "usage", "done"]);
  const usage = events.find((event) => event.type === "usage");
  assert.equal(usage?.type === "usage" && usage.usage.cachedInputTokens, 60);
});

test("embedding invalid usage falls back without losing vectors", async () => {
  const embeddings = new EmbeddingManager({
    test: {
      async embed() {
        return { provider: "test", modelKey: "test", providerModel: "test", vectors: [{ index: 0, embedding: [1, 2] }], usage: { ...valid, promptTokens: -1 } };
      },
    },
  }, { test: { provider: "test", providerModel: "test" } });
  const result = await embeddings.embed({ modelKey: "test", input: ["需要编码的文字"] });
  assert.equal(result.usage?.estimated, true);
  assert.deepEqual(result.vectors, [{ index: 0, embedding: [1, 2] }]);
});

test("invalid usage produces a payload-free diagnostic and logger failure is nonfatal", () => {
  const warnings: unknown[] = [];
  const logger = { warn: (...args: unknown[]) => warnings.push(args) } as unknown as StructuredLogger;
  const broken = { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 };
  assert.equal(parseOpenAICompatibleChatUsage(broken, "test", logger), undefined);
  assert.deepEqual(warnings, [["invalid provider usage; using server fallback", {
    provider: "test", operation: "chat", reason: "invalid_usage_counters", usageSource: "estimated_or_missing",
  }]]);
  const failingLogger = { warn() { throw new Error("logging unavailable"); } } as unknown as StructuredLogger;
  assert.equal(parseOpenAICompatibleChatUsage(broken, "test", failingLogger), undefined);
});
