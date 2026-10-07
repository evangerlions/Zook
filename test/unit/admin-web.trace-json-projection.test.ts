import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTraceRequestForJson,
  compactTraceTurnForJson,
} from "../../apps/admin-web/app/lib/trace-json-projection.ts";
import type { AiNovelTraceRequest, AiNovelTraceTurn } from "../../apps/admin-web/app/lib/types.ts";

function requestWithStreamDeltas(): AiNovelTraceRequest {
  return {
    id: "request-1",
    index: 0,
    sceneKey: "writing",
    status: "completed",
    capturedAt: "2026-09-20T00:00:00.000Z",
    messages: [{ role: "assistant", content: "最终正文" }],
    events: [
      { type: "content_delta", text: "不应出现在压缩 JSON 中", raw: { type: "content_delta", text: "duplicate" } },
      { type: "reasoning_delta", text: "也不应逐字保留" },
      { raw: { type: "content_delta", text: "嵌套的增量也不保留" } },
      {
        type: "tool_call",
        name: "read_draft",
        arguments: { chapterId: 1 },
        raw: { providerEventId: "evt-tool", tool_calls: [{ duplicate: true }] },
      },
      {
        type: "usage",
        usage: { promptTokens: 10, completionTokens: 4 },
        raw: { type: "usage", providerMetric: "bucket-1", text: "duplicate text" },
      },
    ],
    model: "test-model",
    tokenCount: 14,
    toolNames: ["read_draft"],
    raw: {
      provider: "test-provider",
      providerModel: "test-model",
      context: { agentProtocol: "pi-v1" },
      maxTokens: 8192,
      completion: {
        content: "最终正文",
        raw: {
          finish_reason: "length",
          usage: { prompt_tokens: 120, completion_tokens: 8192 },
          choices: [{ finish_reason: "length", message: { content: "duplicate completion" } }],
          traceEnvelopeId: "provider-envelope-1",
        },
      },
    },
  };
}

test("trace JSON aggregates stream deltas and keeps useful request details", () => {
  const projected = compactTraceRequestForJson(requestWithStreamDeltas());
  const json = JSON.stringify(projected);

  assert.doesNotMatch(json, /不应出现在压缩 JSON 中/);
  assert.doesNotMatch(json, /也不应逐字保留/);
  assert.doesNotMatch(json, /duplicate completion/);
  assert.doesNotMatch(json, /duplicate text/);
  assert.deepEqual(projected.events, {
    total: 5,
    deltaSummary: {
      content_delta: { count: 2, characters: 23 },
      reasoning_delta: { count: 1, characters: 7 },
    },
    details: [
      {
        type: "tool_call",
        name: "read_draft",
        arguments: { chapterId: 1 },
        raw: { providerEventId: "evt-tool" },
      },
      {
        type: "usage",
        usage: { promptTokens: 10, completionTokens: 4 },
        raw: { type: "usage", providerMetric: "bucket-1" },
      },
    ],
  });
  assert.deepEqual(projected.messages, [{ role: "assistant", content: "最终正文" }]);
  assert.deepEqual(projected.completion, {
    content: "最终正文",
    raw: {
      finish_reason: "length",
      usage: { prompt_tokens: 120, completion_tokens: 8192 },
      choices: [{ finish_reason: "length" }],
      traceEnvelopeId: "provider-envelope-1",
    },
  });
  assert.equal((projected.raw as Record<string, unknown>).maxTokens, 8192);
});

test("full turn JSON uses compact requests instead of duplicated raw payloads", () => {
  const request = requestWithStreamDeltas();
  const turn: AiNovelTraceTurn = {
    id: "turn-1",
    index: 0,
    status: "completed",
    capturedAt: request.capturedAt,
    messages: request.messages,
    requests: [request],
    toolNames: request.toolNames,
    contextDiff: [],
    raw: { requests: [request.raw] },
  };

  const projected = compactTraceTurnForJson(turn);
  const json = JSON.stringify(projected);
  assert.doesNotMatch(json, /duplicate completion/);
  assert.doesNotMatch(json, /不应出现在压缩 JSON 中/);
  assert.equal((projected.requests as Array<Record<string, unknown>>).length, 1);
});
