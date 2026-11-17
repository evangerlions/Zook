import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiNovelDebugTraceViewModel,
} from "../../src/modules/ai-novel/ai-novel-debug-trace-view-model.ts";
import type {
  AiNovelDebugTraceSession,
} from "../../src/modules/ai-novel/ai-novel-debug-trace.service.ts";

test("final tool calls and their recorded results appear after the request context", () => {
  const session = {
    manifest: { sessionId: "chapter", kind: "import_book", status: "completed", captureCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    captures: [{ capturedAt: "2026-01-01", status: "completed", trace: {
      modelRequests: [{ messages: [{ role: "user", content: "split" }], completion: { content: "done" }, events: [{ type: "tool_call", toolCall: { id: "final", name: "submit_chapters", input: { chapter_lines: [1, 3] } } }] }],
      agentEvents: [{ type: "tool_execution_end", toolCallId: "final", toolName: "submit_chapters", isError: false, content: [{ type: "text", text: '{"ok":true,"accepted":true}' }] }],
    } }],
  } satisfies AiNovelDebugTraceSession;
  const messages = buildAiNovelDebugTraceViewModel(session).turns[0]!.messages;
  assert.equal(messages.length, 3);
  assert.equal(messages[1]?.role, "assistant");
  assert.deepEqual(messages[1]?.toolCalls, [{ id: "final", name: "submit_chapters", input: { chapter_lines: [1, 3] } }]);
  assert.equal(messages[2]?.role, "tool");
  assert.equal(messages[2]?.content, '{"ok":true,"accepted":true}');
  assert.equal(messages[2]?.isError, false);
  session.captures[0]!.trace.agentEvents.length = 0;
  const oldMessages = buildAiNovelDebugTraceViewModel(session).turns[0]!.messages;
  assert.equal(oldMessages[2]?.resultUnavailable, true);
  assert.equal(oldMessages[2]?.content, "（未记录工具执行结果）");
});

test("trace view model groups explicit turn ids and compares context", () => {
  const session: AiNovelDebugTraceSession = {
    manifest: {
      sessionId: "conversation-1",
      kind: "writing",
      status: "completed",
      captureCount: 2,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:01.000Z",
    },
    captures: [
      {
        capturedAt: "2026-09-09T00:00:00.000Z",
        status: "running",
        trace: {
          modelRequests: [
            {
              requestIndex: 1,
              sceneKey: "write_turn",
              context: { turnId: "turn-a" },
              messages: [{ role: "user", content: "Continue." }],
              events: [{ type: "tool_call_delta", toolCallName: "read_memory" }],
            },
            {
              requestIndex: 2,
              sceneKey: "write_turn",
              context: { turnId: "turn-a" },
              messages: [
                { role: "user", content: "Continue." },
                { role: "assistant", content: "I will inspect memory." },
              ],
              events: [{ type: "tool_call", toolCallName: "read_memory" }],
            },
          ],
        },
      },
      {
        capturedAt: "2026-09-09T00:00:01.000Z",
        status: "completed",
        trace: {
          modelRequests: [
            {
              requestIndex: 1,
              sceneKey: "write_turn",
              context: { turnId: "turn-b" },
              messages: [{ role: "user", content: "Write the next beat." }],
            },
          ],
        },
      },
    ],
  };

  const model = buildAiNovelDebugTraceViewModel(session);
  assert.equal(model.turns.length, 2);
  assert.equal(model.turns[0]?.id, "turn-a");
  assert.equal(model.turns[0]?.requests.length, 2);
  assert.equal(model.turns[0]?.userMessage?.content, "Continue.");
  assert.equal(model.turns[1]?.id, "turn-b");
  assert.ok(model.turns[1]?.contextDiff.some((line) => line.kind === "added"));
  assert.ok(model.turns[1]?.contextDiff.some((line) => line.kind === "removed"));
});
test("trace view model falls back to adjacent user messages when no turn id exists", () => {
  const session = {
    manifest: {
      sessionId: "conversation-2",
      kind: "writing" as const,
      status: "completed" as const,
      captureCount: 1,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:01.000Z",
    },
    captures: [
      {
        capturedAt: "2026-09-09T00:00:00.000Z",
        status: "completed" as const,
        trace: {
          modelRequests: [
            { messages: [{ role: "user", content: "First" }] },
            {
              messages: [
                { role: "user", content: "First" },
                { role: "assistant", content: "Tool loop" },
              ],
            },
            { messages: [{ role: "user", content: "Second" }] },
          ],
        },
      },
    ],
  } satisfies AiNovelDebugTraceSession;

  const model = buildAiNovelDebugTraceViewModel(session);
  assert.equal(model.turns.length, 2);
  assert.equal(model.turns[0]?.requests.length, 2);
  assert.equal(model.turns[1]?.userMessage?.content, "Second");
});

test("trace view model keeps legacy top-level messages and runs visible as turns", () => {
  const session = {
    manifest: {
      sessionId: "conversation-legacy",
      kind: "writing" as const,
      status: "completed" as const,
      captureCount: 2,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:01.000Z",
    },
    captures: [
      {
        capturedAt: "2026-09-09T00:00:00.000Z",
        status: "completed" as const,
        trace: {
          messages: [{ role: "user", content: "Legacy message" }],
          events: [{ type: "content_delta", text: "Legacy answer" }],
        },
      },
      {
        capturedAt: "2026-09-09T00:00:01.000Z",
        status: "completed" as const,
        trace: {
          runs: [
            {
              messages: [{ role: "user", content: "Legacy run" }],
              events: [{ type: "tool_call", toolName: "read_memory" }],
            },
          ],
        },
      },
    ],
  } satisfies AiNovelDebugTraceSession;

  const model = buildAiNovelDebugTraceViewModel(session);
  assert.equal(model.turns.length, 2);
  assert.equal(model.turns[0]?.userMessage?.content, "Legacy message");
  assert.equal(model.turns[1]?.userMessage?.content, "Legacy run");
});

test("trace view model prefers Pi context occupancy and keeps provider fallback explicit", () => {
  const session = {
    manifest: {
      sessionId: "conversation-context",
      kind: "writing" as const,
      status: "completed" as const,
      captureCount: 1,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:01.000Z",
    },
    captures: [
      {
        capturedAt: "2026-09-09T00:00:00.000Z",
        status: "completed" as const,
        trace: {
          modelRequests: [
            {
              requestIndex: 1,
              messages: [{ role: "user", content: "Write." }],
              usage: {
                promptTokens: 900,
                contextWindowTokens: 1000,
                totalTokens: 1000,
              },
            },
            {
              requestIndex: 2,
              messages: [{ role: "user", content: "Write." }],
              contextUsage: {
                occupiedTokens: 250,
                contextWindowTokens: 1000,
                source: "pi",
              },
              usage: { totalTokens: 1200 },
            },
          ],
        },
      },
    ],
  } satisfies AiNovelDebugTraceSession;

  const model = buildAiNovelDebugTraceViewModel(session);
  assert.deepEqual(model.turns[0]?.requests[0]?.contextUsage, {
    occupiedTokens: 900,
    contextWindowTokens: 1000,
    source: "provider",
  });
  assert.deepEqual(model.turns[0]?.requests[1]?.contextUsage, {
    occupiedTokens: 250,
    contextWindowTokens: 1000,
    source: "pi",
  });
  assert.deepEqual(model.turns[0]?.contextUsage, {
    occupiedTokens: 250,
    contextWindowTokens: 1000,
    source: "pi",
  });
});
