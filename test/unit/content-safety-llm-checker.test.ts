import assert from "node:assert/strict";
import test from "node:test";
import type { ContentSafetyConfig } from "../../src/shared/types.ts";
import { LlmContentSafetyChecker } from "../../src/services/content-safety-llm-checker.ts";
import type { LLMCompletionRequest, LLMCompletionResult } from "../../src/services/llm-manager.ts";

const config: ContentSafetyConfig = {
  enabled: true,
  longTextThresholdChars: 2000,
  keyword: { enabled: false, rules: [] },
  llm: { enabled: true, modelKey: "qwen3.5-flash", timeoutMs: 1000 },
  aliyun: {
    enabled: false,
    endpoint: "https://example.test",
    region: "cn-shanghai",
    service: "chat_detection",
    accessKeyIdPasswordKey: "",
    accessKeySecretPasswordKey: "",
    timeoutMs: 1000,
  },
};

test("content safety LLM calls preserve app scope and optional user attribution", async () => {
  const capturedRequests: LLMCompletionRequest[] = [];
  const checker = new LlmContentSafetyChecker({
    async complete(request) {
      capturedRequests.push(request);
      return {
        provider: "provider",
        modelKey: request.modelKey,
        providerModel: "provider-model",
        text: "",
        toolCalls: [{
          id: "decision-1",
          name: "submit_content_safety_decision",
          input: { decision: "pass", category: "safe" },
        }],
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
      } satisfies LLMCompletionResult;
    },
  } as never, {
    async recordCheck() {},
    logDecision() {},
    throwSensitive() {
      throw new Error("unexpected sensitive result");
    },
  });

  await checker.check({ appId: "ai_novel", userId: "user_1", text: "safe input" }, config, "safe input");
  await checker.check({ appId: "ai_novel", text: "safe input" }, config, "safe input");

  assert.deepEqual(capturedRequests.map((request) => request.usageOwner), [
    { appId: "ai_novel", userId: "user_1" },
    { appId: "ai_novel" },
  ]);
});
