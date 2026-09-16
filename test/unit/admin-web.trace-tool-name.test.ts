import assert from "node:assert/strict";
import test from "node:test";

import { resolveTraceToolName } from "../../apps/admin-web/app/lib/trace-tool-name.ts";
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
