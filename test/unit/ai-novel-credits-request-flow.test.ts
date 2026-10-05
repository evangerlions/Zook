import assert from "node:assert/strict";
import test from "node:test";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { AiNovelCreditsRequestFlow } from "../../src/modules/ai-novel/credits/ai-novel-credits-request-flow.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { syntheticAiNovelReply } from "../../src/modules/ai-novel/credits/synthetic-ai-novel-reply.ts";
import { PublicApiMessages } from "../../src/generated/i18n/public-api-messages.generated.ts";
import { LLMManager } from "../../src/services/llm-manager.ts";
import { EmbeddingManager } from "../../src/services/embedding-manager.ts";
import { LlmCallObservationRecorder } from "../../src/services/llm-call-observation.ts";
import { InMemoryLlmObservabilityStore } from "../../src/testing/in-memory-llm-observability-store.ts";
import { completeRequiredToolViaStream } from "../../src/modules/ai-novel/ai-novel-required-tool-completer.ts";

const pricing = { cachedInputPointsPerMillionTokens: 20, inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 400 };
const usage = { promptTokens: 30000, cachedInputTokens: 24000, completionTokens: 2000, totalTokens: 32000 };
const request = { sceneKey: "write_turn", messages: [{ role: "user", content: "write" }], context: { billingJobId: "job" } };
const opts = { userId: "u", requestId: "r", locale: "zh-CN" };
const response = { sceneKey: "write_turn", completion: { sceneRouteKey: "write_turn", provider: "test", providerModel: "m", content: "text", finishReason: "stop" } };
function fixture(enabled = true) {
  const credits = new AiNovelCreditsService(new InMemoryAiNovelCreditsStore(), async () => "free");
  return { credits, flow: new AiNovelCreditsRequestFlow(credits, enabled) };
}
async function collect<T>(stream: AsyncIterable<T>) { const result: T[] = []; for await (const value of stream) result.push(value); return result; }

test("synthetic reply supports every locale, text then action then done; cancellation prevents navigation", async () => {
  for (const locale of Object.keys(PublicApiMessages)) {
    const events = await collect(syntheticAiNovelReply({ locale, sceneKey: "write_turn", actionId: "r" }));
    assert.equal(events.at(-2)?.type, "client_action");
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(events.slice(0, -2).every((e) => e.type === "content_delta"));
    assert.ok(events.every((e) => e.type !== "usage" && e.type !== "tool_call"));
  }
  const abort = new AbortController();
  const iterator = syntheticAiNovelReply({ sceneKey: "write_turn", actionId: "r", signal: abort.signal });
  await iterator.next(); abort.abort();
  assert.equal((await collect(iterator)).length, 0);
});

test("enabled flow accepts old callers without any client billing protocol", async () => {
  const { flow } = fixture();
  assert.equal(await flow.complete({ ...request, context: {} }, opts, async () => response), response);
  assert.equal(await fixture(false).flow.complete({ ...request, context: {} }, {}, async () => response), response);
});

test("zero balance blocks before execute/provider and returns business SSE without usage", async () => {
  const { flow, credits } = fixture();
  await credits.begin("u", "consume", "r0");
  await credits.record("u", "consume", "r0", { callId: "cost", modelKey: "m", usage, pricing, pointMicros: "20000000" });
  await credits.releaseRequest("u", "consume", "r0");
  let calls = 0;
  const events = await collect(flow.stream(request, opts, async function* () { calls++; yield { type: "content_delta", text: "wrong" }; }));
  assert.equal(calls, 0);
  assert.equal(events.at(-2)?.type, "client_action"); assert.equal(events.at(-1)?.type, "done");
  await assert.rejects(flow.embeddings({ sceneKey: "memory_embedding", input: ["text"], context: request.context }, opts, async () => { calls++; throw Error("unexpected"); }));
  assert.equal(calls, 0);
});

test("manager price finalization is the exact same object/result used by accounting and Admin", async () => {
  const { flow, credits } = fixture();
  const store = new InMemoryLlmObservabilityStore();
  const manager = new LLMManager({ test: { complete: async () => ({ provider: "test", modelKey: "m", providerModel: "m", text: "text", usage }), stream: async function* () {} } }, { m: { provider: "test", providerModel: "m" } }, { pointPricingResolver: async () => pricing, llmCallObservationRecorder: new LlmCallObservationRecorder(store) });
  let seen: string | undefined;
  await flow.complete(request, { ...opts, onUsageFinalized: async (record) => { seen = record.pointMicros; } }, async (options) => {
    await manager.complete({ modelKey: "m", messages: [{ role: "user", content: "write" }], onUsageFinalized: options.onUsageFinalized, requirePointPricing: true });
    return response;
  });
  assert.equal(seen, "1880000");
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "18120000");
  assert.equal((await credits.balance("u")).remainingPoints, 18.12);
});

test("required-tool retry measures both actual provider attempts", async () => {
  const { flow, credits } = fixture(); let calls = 0;
  const manager = new LLMManager({ test: { complete: async () => { throw Error("unexpected"); }, stream: async function* () {
    calls++;
    if (calls === 2) yield { type: "tool_call", toolCall: { id: "tool", name: "submit", input: {} } };
    else yield { type: "content_delta", text: "retry" };
    yield { type: "usage", usage }; yield { type: "done", finishReason: "stop" };
  } } }, { m: { provider: "test", providerModel: "m" } }, { pointPricingResolver: async () => pricing });
  await flow.complete(request, opts, async (options) => {
    await completeRequiredToolViaStream(manager, { sceneRouteKey: "test", modelKey: "m", messages: [{ role: "user", content: "write" }], forcedToolName: "submit", temperature: 0, maxTokens: 100, onUsageFinalized: options.onUsageFinalized, requirePointPricing: true });
    return response;
  });
  assert.equal(calls, 2);
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "16240000");
});

test("embedding uses the same priced pipeline and settles on the server", async () => {
  const { flow, credits } = fixture();
  const manager = new EmbeddingManager({ test: { embed: async () => ({ provider: "test", modelKey: "e", providerModel: "e", vectors: [{ index: 0, embedding: [1] }], usage: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 } }) } }, { e: { provider: "test", providerModel: "e" } }, { pointPricingResolver: async () => ({ inputPointsPerMillionTokens: 20, outputPointsPerMillionTokens: 0 }) });
  await flow.embeddings({ sceneKey: "memory_embedding", input: ["text"], context: request.context }, opts, async (options) => {
    const result = await manager.embed({ modelKey: "e", input: ["text"], requirePointPricing: true, onUsageFinalized: options.onUsageFinalized });
    return { sceneKey: "memory_embedding", sceneRouteKey: "memory_embedding", ...result };
  });
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "19980000");
});

test("unpriced models fail before provider; failed and disconnected streams release without debit", async () => {
  const { flow, credits } = fixture(); let calls = 0;
  const manager = new LLMManager({ test: { complete: async () => { calls++; return { provider: "test", modelKey: "m", providerModel: "m", text: "text" }; }, stream: async function* () {} } }, { m: { provider: "test", providerModel: "m" } });
  await assert.rejects(flow.complete(request, opts, async (options) => {
    await manager.complete({ modelKey: "m", messages: [{ role: "user", content: "write" }], requirePointPricing: true, onUsageFinalized: options.onUsageFinalized }); return response;
  }));
  assert.equal(calls, 0); assert.equal((await credits.balance("u")).remainingPoints, 20);

  const interrupted = flow.stream({ ...request, context: { billingJobId: "interrupted" } }, opts, async function* () { yield { type: "content_delta", text: "partial" }; });
  await interrupted.next(); await interrupted.return(undefined);
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "20000000");
});

test("length completion with missing provider usage charges the existing server estimate", async () => {
  const { flow, credits } = fixture();
  const manager = new LLMManager({ test: {
    complete: async () => ({ provider: "test", modelKey: "m", providerModel: "m", text: "A completed partial response", finishReason: "length" }),
    stream: async function* () {},
  } }, { m: { provider: "test", providerModel: "m" } }, { pointPricingResolver: async () => pricing });
  let estimatedCost = "0";
  await flow.complete({ ...request, context: undefined }, {
    ...opts, onUsageFinalized: async (record) => {
      assert.equal(record.usageSource, "estimated");
      estimatedCost = record.pointMicros!;
    },
  }, async (options) => {
    await manager.complete({ modelKey: "m", messages: request.messages, onUsageFinalized: options.onUsageFinalized, requirePointPricing: true });
    return { ...response, completion: { ...response.completion, finishReason: "length" } };
  });
  assert.ok(BigInt(estimatedCost) > 0n);
  assert.equal((await credits.balanceMicros("u")).remainingMicros, String(20_000_000n - BigInt(estimatedCost)));
});

test("successful earlier rounds remain billed when a later round throws", async () => {
  const { flow, credits } = fixture();
  let calls = 0;
  const manager = new LLMManager({ test: {
    complete: async () => {
      if (++calls === 2) throw Error("later provider failure");
      return { provider: "test", modelKey: "m", providerModel: "m", text: "text", usage };
    }, stream: async function* () {},
  } }, { m: { provider: "test", providerModel: "m" } }, { pointPricingResolver: async () => pricing });
  await assert.rejects(flow.complete(request, opts, async (options) => {
    const call = { modelKey: "m", messages: request.messages, onUsageFinalized: options.onUsageFinalized, requirePointPricing: true };
    await manager.complete(call);
    assert.equal((await credits.balanceMicros("u")).remainingMicros, "18120000");
    await manager.complete(call);
    return response;
  }), /later provider failure/);
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "18120000");
  assert.equal(await credits.begin("u", "new-server-request", "new"), "allowed");
});

test("known cancellation before usage callback is not charged", async () => {
  const { flow, credits } = fixture();
  const abort = new AbortController();
  const manager = new LLMManager({ test: {
    complete: async () => { abort.abort(); return { provider: "test", modelKey: "m", providerModel: "m", text: "text", usage }; },
    stream: async function* () {},
  } }, { m: { provider: "test", providerModel: "m" } }, { pointPricingResolver: async () => pricing });
  await flow.complete(request, { ...opts, signal: abort.signal }, async (options) => {
    await manager.complete({ modelKey: "m", messages: request.messages, onUsageFinalized: options.onUsageFinalized, requirePointPricing: true });
    return response;
  });
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "20000000");
});
