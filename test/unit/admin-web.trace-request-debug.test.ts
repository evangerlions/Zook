import assert from "node:assert/strict";
import test from "node:test";

import { collectTraceRequestDebugContext } from "../../apps/admin-web/app/lib/trace-request-debug.ts";
import type { AiNovelTraceTurn } from "../../apps/admin-web/app/lib/types.ts";

test("trace request debug context extracts prompt and tools from request payloads", () => {
  const turn = {
    id: "turn-1",
    index: 0,
    status: "completed",
    capturedAt: "2026-09-15T00:00:00.000Z",
    messages: [],
    requests: [{
      id: "request-1",
      index: 0,
      status: "completed",
      capturedAt: "2026-09-15T00:00:00.000Z",
      messages: [{ role: "system", content: "system rules" }],
      events: [],
      toolNames: ["read_draft"],
      raw: {
        suppliedTools: ["read_draft", "write_draft"],
        events: [{
          actionPayload: {
            requestBody: {
              providerOptions: {
                tools: [{
                  type: "function",
                  function: {
                    name: "read_draft",
                    description: "Read the complete current draft.",
                    parameters: { type: "object", properties: { chapterId: { type: "string" } } },
                  },
                }],
              },
            },
          },
        }],
      },
    }],
    toolNames: ["read_draft"],
    contextDiff: [],
    raw: {},
  } satisfies AiNovelTraceTurn;

  assert.deepEqual(collectTraceRequestDebugContext(turn), {
    systemPrompt: "system rules",
    tools: [
      {
        name: "read_draft",
        description: "Read the complete current draft.",
        inputSchema: { type: "object", properties: { chapterId: { type: "string" } } },
      },
      { name: "write_draft", description: "", inputSchema: {} },
    ],
  });
});

test("trace request debug context also reads a directly captured system prompt", () => {
  const turn = {
    id: "turn-2",
    index: 1,
    status: "completed",
    capturedAt: "2026-09-15T00:00:00.000Z",
    messages: [],
    requests: [{
      id: "request-2",
      index: 0,
      status: "completed",
      capturedAt: "2026-09-15T00:00:00.000Z",
      messages: [],
      events: [],
      toolNames: [],
      raw: { systemPrompt: "## Role\nWrite from the current context." },
    }],
    toolNames: [],
    contextDiff: [],
    raw: {},
  } satisfies AiNovelTraceTurn;

  assert.deepEqual(collectTraceRequestDebugContext(turn), {
    systemPrompt: "## Role\nWrite from the current context.",
    tools: [],
  });
});
