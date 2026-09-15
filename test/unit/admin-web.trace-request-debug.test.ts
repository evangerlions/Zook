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
        events: [{
          actionPayload: {
            requestBody: {
              providerOptions: {
                tools: [{
                  type: "function",
                  function: {
                    name: "read_draft",
                    description: "Read draft",
                    parameters: { type: "object", properties: {} },
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
    tools: [{ name: "read_draft", description: "Read draft", inputSchema: { type: "object", properties: {} } }],
  });
});
