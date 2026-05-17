import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import {
  type LLMCompletionResult,
  type LLMProvider,
  LLMManager,
  type LLMStreamEvent,
  type ResolvedLLMCompletionRequest,
} from "../../src/services/llm-manager.ts";

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

test("createApplication exposes llmManager through runtime services", async () => {
  const runtime = await createApplication();

  assert.ok(runtime.services.llmManager);
  assert.equal(typeof runtime.services.llmManager.complete, "function");
  assert.equal(typeof runtime.services.llmManager.stream, "function");
});
