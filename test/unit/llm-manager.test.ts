import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { InMemoryLlmObservabilityStore } from "../../src/testing/in-memory-llm-observability-store.ts";
import { LlmHealthService } from "../../src/services/llm-health.service.ts";
import { LlmMetricsService } from "../../src/services/llm-metrics.service.ts";
import { LlmCallerCancelledError } from "../../src/services/llm-caller-cancellation.ts";
import {
  DEFAULT_LLM_MODEL_REGISTRY,
  type LLMCompletionResult,
  type LLMProvider,
  LLMManager,
  type LLMStreamEvent,
  type ResolvedLLMCompletionRequest,
} from "../../src/services/llm-manager.ts";

test("llm manager excludes caller cancellation from route health", async () => {
  const caller = new AbortController();
  const observabilityStore = new InMemoryLlmObservabilityStore();
  const healthService = new LlmHealthService(observabilityStore);
  const metricsService = new LlmMetricsService(
    observabilityStore,
    healthService,
  );
  const provider: LLMProvider = {
    async complete(): Promise<LLMCompletionResult> {
      throw new Error("should use stream");
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      yield { type: "content_delta", text: "partial" };
      if (!request.signal?.aborted) {
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      }
      throw new LlmCallerCancelledError(request.signal?.reason);
    },
  };
  const manager = new LLMManager(
    { bailian: provider },
    DEFAULT_LLM_MODEL_REGISTRY,
    {
      llmHealthService: healthService,
      llmMetricsService: metricsService,
    },
  );
  const events: LLMStreamEvent[] = [];

  for await (const event of manager.stream({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "hello" }],
    signal: caller.signal,
  })) {
    events.push(event);
    caller.abort(new DOMException("Client disconnected.", "AbortError"));
  }

  assert.deepEqual(events, [{ type: "content_delta", text: "partial" }]);
  assert.equal(observabilityStore.observations.length, 1);
  assert.equal(observabilityStore.observations[0]?.outcome, "cancelled");
  assert.equal(observabilityStore.observations[0]?.healthImpact, "neutral");
  assert.equal(
    await observabilityStore.getRouteHealth({
      routingModelKey: "kimi2.5",
      provider: "bailian",
      providerModel: "kimi/kimi-k2.5",
      operation: "chat",
    }),
    undefined,
  );
});

test("llm manager resolves kimi2.5 to the Bailian provider model", async () => {
  let capturedRequest: ResolvedLLMCompletionRequest | undefined;
  const provider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      capturedRequest = request;
      return {
        provider: "bailian",
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "ok",
      };
    },
    async *stream(): AsyncIterable<LLMStreamEvent> {
      yield { type: "done" };
    },
  };

  const manager = new LLMManager({
    bailian: provider,
  });

  const result = await manager.complete({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(result.providerModel, "kimi/kimi-k2.5");
  assert.equal(capturedRequest?.model.provider, "bailian");
  assert.equal(capturedRequest?.model.providerModel, "kimi/kimi-k2.5");
});

test("llm manager rejects unknown model keys", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should not reach provider");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        yield { type: "done" };
      },
    },
  });

  await assert.rejects(
    async () =>
      manager.complete({
        modelKey: "qwen-plus",
        messages: [{ role: "user", content: "hello" }],
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_MODEL_NOT_FOUND",
  );
});

test("llm manager completeViaStream fails fast when no stream content arrives", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should use stream");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        await new Promise(() => undefined);
      },
    },
  });

  const startedAt = Date.now();
  await assert.rejects(
    async () =>
      manager.completeViaStream(
        {
          modelKey: "kimi2.5",
          messages: [{ role: "user", content: "hello" }],
        },
        { firstContentTimeoutMs: 5 },
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_REQUEST_FAILED" &&
      "details" in error &&
      (error.details as Record<string, unknown>).reason ===
        "first_byte_timeout",
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("llm manager completeViaStream captures streamed tool calls", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should use stream");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call_review_1",
            name: "submit_chapter_review",
            input: { verdict: "pass" },
          },
        };
        yield { type: "done", finishReason: "tool_calls" };
      },
    },
  });

  const result = await manager.completeViaStream({
    modelKey: "kimi2.5",
    messages: [{ role: "user", content: "review" }],
  });

  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(result.toolCalls, [
    {
      id: "call_review_1",
      name: "submit_chapter_review",
      input: { verdict: "pass" },
    },
  ]);
});

test("llm manager completeViaStream rejects streams that end before done", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should use stream");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        yield { type: "content_delta", text: "partial" };
      },
    },
  });

  await assert.rejects(
    async () =>
      manager.completeViaStream({
        modelKey: "kimi2.5",
        messages: [{ role: "user", content: "hello" }],
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_RESPONSE_INVALID" &&
      "details" in error &&
      (error.details as Record<string, unknown>).reason ===
        "missing_done_event",
  );
});

test("llm manager stream rejects streams that end before done", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should use stream");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        yield { type: "content_delta", text: "partial" };
      },
    },
  });

  await assert.rejects(
    async () => {
      for await (const _event of manager.stream({
        modelKey: "kimi2.5",
        messages: [{ role: "user", content: "hello" }],
      })) {
        // Consume the partial event so iterator completion is observed.
      }
    },
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_RESPONSE_INVALID" &&
      "details" in error &&
      (error.details as Record<string, unknown>).reason ===
        "missing_done_event",
  );
});

test("llm manager completeViaStream rejects unknown stream events", async () => {
  const manager = new LLMManager({
    bailian: {
      async complete(): Promise<LLMCompletionResult> {
        throw new Error("should use stream");
      },
      async *stream(): AsyncIterable<LLMStreamEvent> {
        yield { type: "unexpected_event" } as unknown as LLMStreamEvent;
      },
    },
  });

  await assert.rejects(
    async () =>
      manager.completeViaStream({
        modelKey: "kimi2.5",
        messages: [{ role: "user", content: "hello" }],
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "LLM_PROVIDER_RESPONSE_INVALID" &&
      "details" in error &&
      (error.details as Record<string, unknown>).reason ===
        "unsupported_stream_event",
  );
});

test("createApplication exposes llmManager through runtime services", async () => {
  const runtime = await createApplication();

  assert.ok(runtime.services.llmManager);
  assert.equal(typeof runtime.services.llmManager.complete, "function");
  assert.equal(typeof runtime.services.llmManager.stream, "function");
});
