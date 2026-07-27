import assert from "node:assert/strict";
import test from "node:test";
import {
  LLMManager,
  type LLMProvider,
  type LLMStreamEvent,
  type LLMUsage,
} from "../../src/services/llm-manager.ts";

test("LLM stream estimates usage from reasoning, content, and tool deltas when provider usage is missing", async () => {
  const provider: LLMProvider = {
    async complete(request) {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "plain completion",
      };
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      yield { type: "reasoning_delta", text: "thinking through the plan" };
      yield { type: "content_delta", text: "chapter body" };
      yield {
        type: "tool_call_delta",
        text: "structured tool payload",
        toolCallName: "ready",
      };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const recordedUsages: LLMUsage[] = [];
  const manager = new LLMManager(
    { test: provider },
    {
      "test-model": {
        provider: "test",
        providerModel: "test-provider-model",
      },
    },
    {
      usageRecorder: (event) => recordedUsages.push(event.usage),
    },
  );

  const events: LLMStreamEvent[] = [];
  for await (const event of manager.stream({
    modelKey: "test-model",
    messages: [{ role: "user", content: "hello" }],
    usageOwner: { appId: "ai_novel", userId: "user_1" },
  })) {
    events.push(event);
  }

  const usageEvent = events.find((event) => event.type === "usage");
  assert.ok(usageEvent);
  assert.equal(usageEvent.usage.estimated, true);
  assert.ok(usageEvent.usage.promptTokens > 0);
  assert.ok(usageEvent.usage.reasoningTokens);
  assert.ok(usageEvent.usage.completionTokens > usageEvent.usage.reasoningTokens);
  assert.equal(recordedUsages.length, 1);
  assert.equal(recordedUsages[0]?.estimated, true);
  assert.equal(recordedUsages[0]?.totalTokens, usageEvent.usage.totalTokens);
  assert.equal(events.at(-1)?.type, "done");
});

test("LLM complete estimates usage from final text and tool calls when provider usage is missing", async () => {
  const provider: LLMProvider = {
    async complete(request) {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "final body",
        reasoningText: "hidden reasoning",
        toolCalls: [
          {
            id: "call_1",
            name: "ready",
            input: { title: "The Door" },
          },
        ],
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: "done" };
    },
  };
  const manager = new LLMManager(
    { test: provider },
    {
      "test-model": {
        provider: "test",
        providerModel: "test-provider-model",
      },
    },
  );

  const result = await manager.complete({
    modelKey: "test-model",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(result.usage?.estimated, true);
  assert.ok((result.usage?.promptTokens ?? 0) > 0);
  assert.ok(result.usage?.reasoningTokens);
  assert.ok((result.usage?.totalTokens ?? 0) > 0);
});

test("LLM stream keeps done when app usage recorder fails", async () => {
  const provider: LLMProvider = {
    async complete(request) {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "plain completion",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: "content_delta", text: "chapter body" };
      yield { type: "done", finishReason: "stop" };
    },
  };
  let recorderError: unknown;
  const manager = new LLMManager(
    { test: provider },
    {
      "test-model": {
        provider: "test",
        providerModel: "test-provider-model",
      },
    },
    {
      usageRecorder: () => {
        throw new Error("stats store is down");
      },
      usageRecorderErrorHandler: (event) => {
        recorderError = event.error;
        throw new Error("logger is down too");
      },
    },
  );

  const events: LLMStreamEvent[] = [];
  for await (const event of manager.stream({
    modelKey: "test-model",
    messages: [{ role: "user", content: "hello" }],
    usageOwner: { appId: "ai_novel", userId: "user_1" },
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    "content_delta",
    "usage",
    "done",
  ]);
  assert.ok(recorderError instanceof Error);
});
