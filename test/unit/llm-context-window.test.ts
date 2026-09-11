import assert from "node:assert/strict";
import test from "node:test";

import {
  withContextUsage,
  ZOOK_CONTEXT_WINDOW_TOKENS,
} from "../../src/services/llm-context-window.ts";

test("Zook emits the fixed context budget independently of the selected model", () => {
  const usage = withContextUsage({
    promptTokens: 250_000,
    completionTokens: 1_000,
    totalTokens: 251_000,
  });

  assert.equal(ZOOK_CONTEXT_WINDOW_TOKENS, 256_000);
  assert.equal(usage?.contextWindowTokens, 256_000);
  assert.equal(usage?.contextUsedRatio, 250_000 / 256_000);
});

test("Zook does not invent usage when neither provider nor local estimation supplied it", () => {
  assert.equal(withContextUsage(undefined), undefined);
});
