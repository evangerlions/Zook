import assert from "node:assert/strict";
import test from "node:test";

import {
  LLMManager,
  type LLMCompletionResult,
  type LLMMessage,
  type LLMProvider,
  type LLMStreamEvent,
} from "../../src/services/llm-manager.ts";
import { completeRequiredToolViaStream } from "../../src/modules/ai-novel/ai-novel-required-tool-completer.ts";

test("required-tool retry compacts old history before its second provider request", async () => {
  const largeToolOutput = "x".repeat(2_700_000);
  const retryResponse = "y".repeat(400_000);
  const captured: LLMMessage[][] = [];
  const provider: LLMProvider = {
    async complete(request): Promise<LLMCompletionResult> {
      return {
        provider: request.model.provider,
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        text: "unused",
      };
    },
    async *stream(request): AsyncIterable<LLMStreamEvent> {
      captured.push(request.messages);
      if (captured.length === 1) {
        yield { type: "content_delta", text: retryResponse };
        yield { type: "done", finishReason: "stop" };
        return;
      }
      yield {
        type: "tool_call",
        toolCall: {
          id: "call_required",
          name: "submit_result",
          input: { ok: true },
        },
      };
      yield { type: "done", finishReason: "tool_calls" };
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

  const result = await completeRequiredToolViaStream(manager, {
    sceneRouteKey: "chapter_summary",
    modelKey: "test-model",
    messages: [
      { role: "user", content: "old request" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_old", name: "read", input: {} }],
      },
      { role: "tool", content: largeToolOutput, toolCallId: "call_old" },
      { role: "user", content: "latest request" },
    ],
    temperature: 0,
    maxTokens: 0,
    forcedToolName: "submit_result",
  });

  assert.equal(result.toolCalls?.[0]?.name, "submit_result");
  assert.equal(captured.length, 2);
  assert.equal(captured[0]?.find((item) => item.toolCallId === "call_old")?.content, largeToolOutput);
  assert.equal(captured[1]?.some((item) => item.toolCallId === "call_old"), false);
  assert.equal(captured[1]?.at(-1)?.content?.includes("must now call submit_result"), true);
});
