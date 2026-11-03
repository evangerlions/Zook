import assert from "node:assert/strict";
import test from "node:test";
import { supportsLegacyAiStreamEvent, supportsModernAiStream } from "../../src/modules/ai-novel/ai-novel-stream-compatibility.ts";

test("stream compatibility uses 1.6.0 as the version boundary", () => {
  for (const value of [undefined, "", "invalid", "1.5.0+1040101", "1.5.99"]) {
    assert.equal(supportsModernAiStream(value), false, String(value));
  }
  for (const value of ["1.6.0", "1.6.0+1060002", "1.7.0", "2.0.0"]) {
    assert.equal(supportsModernAiStream(value), true, value);
  }
});

test("legacy streams accept known events and exclude new event types", () => {
  for (const type of ["local_debug_llm_request", "reasoning_delta", "content_delta", "tool_call_delta", "tool_call", "usage", "done", "error"]) {
    assert.equal(supportsLegacyAiStreamEvent({ type, extra: true }), true, type);
  }
  for (const type of ["client_action", "future_event", "future_delta", ""]) {
    assert.equal(supportsLegacyAiStreamEvent({ type }), false, type);
  }
});
