import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAiNovelDebugTraceViewModel,
} from "../../src/modules/ai-novel/ai-novel-debug-trace-view-model.ts";
import type {
  AiNovelDebugTraceSession,
} from "../../src/modules/ai-novel/ai-novel-debug-trace.service.ts";

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
