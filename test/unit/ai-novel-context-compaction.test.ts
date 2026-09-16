import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER,
  compactAiNovelContext,
} from "../../src/modules/ai-novel/ai-novel-context-compaction.ts";
import type { LLMMessage } from "../../src/services/llm-manager.ts";

const message = (
  role: LLMMessage["role"],
  content: string,
  extra: Partial<LLMMessage> = {},
): LLMMessage => ({ role, content, ...extra });

const text = (tokens: number): string => "x".repeat(tokens * 3);

test("leaves requests under the context limit unchanged", () => {
  const messages = [message("system", "Keep this prompt."), message("user", "hello")];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 100,
  });

  assert.equal(result.withinBudget, true);
  assert.equal(result.didCompact, false);
  assert.strictEqual(result.messages, messages);
});

test("counts the requested output budget before deciding whether to compact", () => {
  const messages = [message("user", "hello")];

  const result = compactAiNovelContext({
    messages,
    maxTokens: 100,
    maxContextTokens: 100,
  });

  assert.equal(result.withinBudget, false);
  assert.equal(result.didCompact, false);
  assert.strictEqual(result.messages, messages);
});

test("uses a conservative estimate for Chinese context text", () => {
  const messages = [
    message("user", "旧".repeat(80_000)),
    message("user", "最新"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 50_000,
  });

  assert.equal(result.droppedTurnCount, 1);
  assert.deepEqual(result.messages.map((item) => item.content), ["最新"]);
  assert.equal(result.withinBudget, true);
});

test("counts provider tool definitions in the context estimate", () => {
  const messages = [message("user", "hello")];

  const result = compactAiNovelContext({
    messages,
    providerOptions: { tools: [{ description: text(40_000) }] },
    maxContextTokens: 10_000,
  });

  assert.equal(result.withinBudget, false);
  assert.equal(result.didCompact, false);
  assert.strictEqual(result.messages, messages);
});

test("does not soft compact the latest round when an old turn must be dropped", () => {
  const oldTool = text(25_000);
  const messages = [
    message("user", "old request"),
    message("assistant", "", {
      toolCalls: [{ id: "call_old", name: "read_old", input: {} }],
    }),
    message("tool", oldTool, { toolCallId: "call_old" }),
    message("user", "latest request"),
    message("assistant", "latest response"),
    message("tool", text(25_000), { toolCallId: "call_latest" }),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 40_000,
  });

  assert.equal(result.softCompactedToolResultCount, 0);
  assert.equal(result.didCompact, true);
  assert.equal(result.withinBudget, true);
  assert.equal(result.messages.some((item) => item.toolCallId === "call_old"), false);
  assert.equal(result.messages[2]?.content, text(25_000));
});

test("soft compacts old tool results once the savings threshold is met", () => {
  const first = text(25_000);
  const second = text(25_000);
  const third = text(25_000);
  const messages = [
    message("user", "turn one"),
    message("tool", first, { toolCallId: "call_1" }),
    message("tool", second, { toolCallId: "call_2" }),
    message("tool", third, { toolCallId: "call_3" }),
    message("user", "latest"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 70_000,
  });

  assert.equal(result.softCompactedToolResultCount, 1);
  assert.equal(result.softCompactedTokens, 25_000);
  assert.equal(result.messages[1]?.content, AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER);
  assert.equal(result.messages[2]?.content, second);
  assert.equal(result.messages[3]?.content, third);
  assert.equal(result.messages[1]?.toolCallId, "call_1");
  assert.equal(messages[1]?.content, first);
});

test("does not soft compact when the removable output is below the savings threshold", () => {
  const messages = [
    message("user", "old"),
    message("tool", text(15_000), { toolCallId: "call_old" }),
    message("user", "latest"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 20_000,
  });

  assert.equal(result.softCompactedToolResultCount, 0);
  assert.equal(result.softCompactedTokens, 0);
  assert.equal(result.messages[1]?.content, text(15_000));
});

test("keeps old error and already-compacted tool results intact", () => {
  const messages = [
    message("user", "old"),
    message("tool", JSON.stringify({ errorCode: "READ_FAILED", detail: text(50_000) }), {
      toolCallId: "error_tool",
    }),
    message("tool", JSON.stringify({ compacted: true, detail: text(50_000) }), {
      toolCallId: "compacted_tool",
    }),
    message("tool", text(25_000), { toolCallId: "read_tool" }),
    message("tool", text(25_000), { toolCallId: "read_tool_2" }),
    message("tool", text(25_000), { toolCallId: "read_tool_3" }),
    message("user", "latest"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 160_000,
  });

  assert.equal(result.messages[1]?.content, messages[1]?.content);
  assert.equal(result.messages[2]?.content, messages[2]?.content);
  assert.equal(result.messages[3]?.content, AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER);
  assert.equal(result.messages[4]?.content, messages[4]?.content);
  assert.equal(result.messages[5]?.content, messages[5]?.content);
  assert.equal(result.droppedMessageCount, 0);
});

test("drops oldest complete turns after soft compaction cannot reach the limit", () => {
  const messages = [
    message("system", "Keep system prompt."),
    message("user", text(40_000)),
    message("assistant", text(20_000), {
      toolCalls: [{ id: "call_old", name: "read_old", input: {} }],
    }),
    message("tool", text(20_000), { toolCallId: "call_old" }),
    message("user", text(40_000)),
    message("assistant", text(20_000)),
    message("user", "latest"),
    message("assistant", "latest response"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 60_000,
  });

  assert.equal(result.droppedTurnCount, 2);
  assert.equal(result.droppedMessageCount, 5);
  assert.deepEqual(
    result.messages.map((item) => item.content),
    ["Keep system prompt.", "latest", "latest response"],
  );
  assert.equal(result.messages.some((item) => item.toolCallId === "call_old"), false);
  assert.equal(result.withinBudget, true);
});

test("sends the original request when the immutable latest context is over budget", () => {
  const messages = [
    message("system", "Keep system prompt."),
    message("user", "old"),
    message("tool", text(40_000), { toolCallId: "call_old" }),
    message("user", text(120_000)),
    message("assistant", "latest response"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 100_000,
  });

  assert.equal(result.didCompact, false);
  assert.equal(result.withinBudget, false);
  assert.strictEqual(result.messages, messages);
  assert.equal(result.messages[2]?.content, text(40_000));
  assert.equal(result.messages[3]?.content, text(120_000));
});

test("drops whole old turns while preserving system messages and tool pairing", () => {
  const messages = [
    message("system", "System prompt."),
    message("user", text(30_000)),
    message("assistant", "", {
      toolCalls: [{ id: "call_1", name: "read", input: {} }],
    }),
    message("tool", text(30_000), { toolCallId: "call_1" }),
    message("user", "latest"),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 10_000,
  });

  assert.equal(result.droppedTurnCount, 1);
  assert.deepEqual(result.messages, [
    message("system", "System prompt."),
    message("user", "latest"),
  ]);
  assert.equal(result.withinBudget, true);
});

test("keeps an old tool call when its result is attached to the latest round", () => {
  const messages = [
    message("user", text(100)),
    message("assistant", "", {
      toolCalls: [{ id: "cross_turn", name: "read", input: {} }],
    }),
    message("user", "latest"),
    message("tool", "result", { toolCallId: "cross_turn" }),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 100,
  });

  assert.equal(result.droppedTurnCount, 0);
  assert.equal(result.withinBudget, false);
  assert.equal(result.messages[1]?.toolCalls?.[0]?.id, "cross_turn");
  assert.equal(result.messages[3]?.toolCallId, "cross_turn");
});

test("does not compact an old result referenced by a latest-round tool call", () => {
  const crossTurnResult = text(25_000);
  const messages = [
    message("user", "old"),
    message("tool", crossTurnResult, { toolCallId: "cross_turn" }),
    message("tool", text(25_000), { toolCallId: "read_1" }),
    message("tool", text(25_000), { toolCallId: "read_2" }),
    message("tool", text(25_000), { toolCallId: "read_3" }),
    message("user", "latest"),
    message("assistant", "", {
      toolCalls: [{ id: "cross_turn", name: "read", input: {} }],
    }),
  ];

  const result = compactAiNovelContext({
    messages,
    maxContextTokens: 80_000,
  });

  assert.equal(result.messages[1]?.content, crossTurnResult);
  assert.equal(result.messages[2]?.content, AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER);
});

test("can keep an established round when an internal retry appends a user message", () => {
  const messages = [
    message("user", text(40_000)),
    message("assistant", "retryable response"),
    message("user", "retry instruction"),
  ];

  const result = compactAiNovelContext({
    messages,
    latestRoundStartIndex: 0,
    maxContextTokens: 10_000,
  });

  assert.equal(result.droppedTurnCount, 0);
  assert.equal(result.withinBudget, false);
  assert.strictEqual(result.messages, messages);
});
