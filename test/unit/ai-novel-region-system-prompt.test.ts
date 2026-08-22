import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAiNovelRegionSystemPrompt,
  CN_AI_ASSISTANT_IDENTITY_RESPONSE,
} from "../../src/modules/ai-novel/ai-novel-region-system-prompt.ts";
import type { LLMMessage } from "../../src/services/llm-manager.ts";

const WORKFLOW_PROMPT = "You are the kickoff-mode novel setup assistant.";

test("CN requests merge the OrangeWrite identity policy into the existing system prompt", () => {
  const messages: LLMMessage[] = [
    { role: "system", content: WORKFLOW_PROMPT },
    { role: "user", content: "你是什么大模型" },
  ];

  const result = applyAiNovelRegionSystemPrompt(messages, "CN");
  const systemMessages = result.filter((message) => message.role === "system");

  assert.equal(systemMessages.length, 1);
  assert.match(String(systemMessages[0]?.content), new RegExp(WORKFLOW_PROMPT));
  assert.match(
    String(systemMessages[0]?.content),
    new RegExp(CN_AI_ASSISTANT_IDENTITY_RESPONSE),
  );
  assert.match(String(systemMessages[0]?.content), /Never claim or imply that you are an overseas model/);
  assert.equal(messages[0]?.content, WORKFLOW_PROMPT);
});

test("CN requests prepend the identity policy when the request has no system message", () => {
  const result = applyAiNovelRegionSystemPrompt(
    [{ role: "user", content: "你好" }],
    "CN",
  );

  assert.equal(result[0]?.role, "system");
  assert.match(
    String(result[0]?.content),
    new RegExp(CN_AI_ASSISTANT_IDENTITY_RESPONSE),
  );
  assert.equal(result[1]?.role, "user");
});

test("GLOBAL and UNKNOWN requests do not receive the CN identity policy", () => {
  const messages: LLMMessage[] = [
    { role: "system", content: WORKFLOW_PROMPT },
    { role: "user", content: "Which model are you?" },
  ];

  for (const region of ["GLOBAL", "UNKNOWN"] as const) {
    const result = applyAiNovelRegionSystemPrompt(messages, region);
    assert.strictEqual(result, messages);
    assert.doesNotMatch(
      String(result[0]?.content),
      new RegExp(CN_AI_ASSISTANT_IDENTITY_RESPONSE),
    );
  }
});
