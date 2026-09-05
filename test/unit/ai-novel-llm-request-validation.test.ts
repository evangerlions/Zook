import assert from "node:assert/strict";
import test from "node:test";

import {
  optionalAiNovelAgentProtocol,
} from "../../src/modules/ai-novel/ai-novel-llm-request-validation.ts";

test("agentProtocol accepts pi-v1 and preserves legacy omission", () => {
  assert.equal(optionalAiNovelAgentProtocol(undefined), undefined);
  assert.equal(optionalAiNovelAgentProtocol(null), undefined);
  assert.equal(optionalAiNovelAgentProtocol("pi-v1"), "pi-v1");
});

test("agentProtocol rejects unknown protocol versions", () => {
  assert.throws(() => optionalAiNovelAgentProtocol("pi-v2"));
});
