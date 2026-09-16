import assert from "node:assert/strict";
import test from "node:test";

import { buildAiNovelConversationDebugMetadata } from "../../src/modules/ai-novel/ai-novel-conversation-debug.ts";

test("conversation debug metadata normalizes the assembled system prompt and tools", () => {
  const metadata = buildAiNovelConversationDebugMetadata({
    messages: [
      { role: "system", content: "base rules" },
      { role: "system", content: "dynamic rules" },
      { role: "user", content: "继续" },
    ],
    providerOptions: {
      tools: [
        {
          type: "function",
          function: {
            name: "read_draft",
            description: "Read the current draft.",
            parameters: { type: "object", properties: {} },
          },
        },
        { type: "function", function: { parameters: "bad" } },
      ],
    },
  });

  assert.equal(metadata.systemPrompt, "base rules\n\ndynamic rules");
  assert.deepEqual(metadata.tools, [{
    name: "read_draft",
    description: "Read the current draft.",
    inputSchema: { type: "object", properties: {} },
  }]);
});
