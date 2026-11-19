import assert from "node:assert/strict";
import test from "node:test";

import { resolveTraceToolInput, resolveTraceToolName } from "../../apps/admin-web/app/lib/trace-tool-name.ts";
import type { AiNovelTraceMessage } from "../../apps/admin-web/app/lib/types.ts";

test("trace tool name resolves a tool result through its assistant tool call id", () => {
  const messages: AiNovelTraceMessage[] = [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call-1", name: "read_writing_context", input: {} }],
    },
    { role: "tool", content: "context", toolCallId: "call-1" },
  ];

  assert.equal(resolveTraceToolName(messages[1]!, messages), "read_writing_context");
});

test("tool input is matched by call id when one assistant calls multiple tools", () => {
  const messages: AiNovelTraceMessage[] = [
    { role: "assistant", content: "", toolCalls: [
      { id: "one", name: "preview", input: { chapter_lines: [4, 74] } },
      { id: "two", name: "preview", input: { chapter_lines: [136] } },
    ] },
    { role: "tool", toolCallId: "two", content: '{"ok":true}' },
    { role: "tool", toolCallId: "one", content: '{"ok":true}' },
  ];
  assert.deepEqual(resolveTraceToolInput(messages[1]!, messages), { available: true, value: { chapter_lines: [136] } });
  assert.deepEqual(resolveTraceToolInput(messages[2]!, messages), { available: true, value: { chapter_lines: [4, 74] } });
});

test("tool inputs handle legacy function arguments and missing records", () => {
  const messages: AiNovelTraceMessage[] = [
    { role: "assistant", content: "", tool_calls: [{ id: "a", function: { name: "match", arguments: '{"query":"chapter"}' } }] },
    { role: "tool", content: "ok", tool_call_id: "a" },
    { role: "tool", content: "ok", tool_call_id: "missing" },
  ];
  assert.deepEqual(resolveTraceToolInput(messages[1]!, messages), { available: true, value: { query: "chapter" } });
  assert.deepEqual(resolveTraceToolInput(messages[2]!, messages), { available: false });
  assert.deepEqual(resolveTraceToolInput({ role: "tool", content: "ok", input: {} }), { available: true, value: {} });
});

test("trace tool name supports legacy direct and OpenAI function-shaped names", () => {
  assert.equal(resolveTraceToolName({ role: "tool", content: "", toolName: "read_meta" }), "read_meta");
  assert.equal(resolveTraceToolName(
    { role: "tool", content: "", toolCallId: "call-2" },
    [
      { role: "assistant", content: "", tool_calls: [{ id: "call-2", function: { name: "update_meta" } }] },
      { role: "tool", content: "", toolCallId: "call-2" },
    ],
  ), "update_meta");
});
