import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalAiNovelE2eProvider,
  shouldUseLocalAiNovelE2eProvider,
} from "../../src/services/local-ainovel-e2e-provider.ts";
import { AppAiRoutingConfigService } from "../../src/services/app-ai-routing-config.service.ts";
import type { ResolvedLLMCompletionRequest } from "../../src/services/llm-manager.ts";

test("local AINovel E2E provider requires explicit flag and local runtime", () => {
  const cases = [
    {
      env: {
        AINOVEL_E2E_LLM_PROVIDER: "1",
        APP_ENV: "online",
        NODE_ENV: "production",
      },
      expected: false,
    },
    {
      env: {
        AINOVEL_E2E_LLM_PROVIDER: "1",
        APP_ENV: "production",
        NODE_ENV: "test",
      },
      expected: false,
    },
    {
      env: {
        AINOVEL_E2E_LLM_PROVIDER: "1",
        APP_ENV: "prod",
        NODE_ENV: "development",
      },
      expected: false,
    },
    {
      env: {
        AINOVEL_E2E_LLM_PROVIDER: "0",
        APP_ENV: "local",
        NODE_ENV: "development",
      },
      expected: false,
    },
    {
      env: {
        AINOVEL_E2E_LLM_PROVIDER: "1",
        APP_ENV: "local",
        NODE_ENV: "development",
      },
      expected: true,
    },
  ] as const;

  for (const testCase of cases) {
    assert.equal(
      shouldUseLocalAiNovelE2eProvider(testCase.env),
      testCase.expected,
      JSON.stringify(testCase.env),
    );
  }
});

test("local AINovel E2E provider streams kickoff update and ready tools", async () => {
  const provider = new LocalAiNovelE2eProvider();
  const events = [];
  for await (const event of provider.stream({
    model: {
      provider: "bailian",
      modelKey: "ainovel-plus-reasoning",
      providerModel: "qwen3.6-plus",
    },
    messages: [{ role: "user", content: "我要写东方玄幻。" }],
    providerOptions: {
      tools: ["update_meta", "ask_question", "ready"].map((name) => ({
        type: "function",
        function: { name },
      })),
    },
  } satisfies ResolvedLLMCompletionRequest)) {
    events.push(event);
  }

  const toolNames = events
    .filter((event) => event.type === "tool_call")
    .map((event) => event.toolCall.name);
  assert.deepEqual(toolNames, ["update_meta", "ready"]);

  const ready = events.find(
    (event) => event.type === "tool_call" && event.toolCall.name === "ready",
  );
  assert.ok(ready && ready.type === "tool_call");
  assert.equal(
    typeof (ready.toolCall.input.mainLine as Record<string, unknown>).summary,
    "string",
  );
});

test("local AINovel E2E provider returns a pass decision for content safety", async () => {
  const provider = new LocalAiNovelE2eProvider();
  const result = await provider.complete({
    model: {
      provider: "bailian",
      modelKey: "qwen3.5-flash",
      providerModel: "qwen3.5-flash",
    },
    messages: [{ role: "user", content: "审核下面的用户输入：你好" }],
    providerOptions: {
      tools: [
        {
          type: "function",
          function: { name: "submit_content_safety_decision" },
        },
      ],
    },
  } satisfies ResolvedLLMCompletionRequest);

  assert.equal(result.toolCalls?.[0]?.name, "submit_content_safety_decision");
  assert.deepEqual(result.toolCalls?.[0]?.input, {
    decision: "pass",
    category: "safe",
  });
});

test("local AINovel E2E mode uses default scene routing without stored admin config", async () => {
  const previousFlag = process.env.AINOVEL_E2E_LLM_PROVIDER;
  const previousAppEnv = process.env.APP_ENV;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AINOVEL_E2E_LLM_PROVIDER = "1";
  process.env.APP_ENV = "local";
  process.env.NODE_ENV = "development";

  try {
    const service = new AppAiRoutingConfigService({
      async getValue() {
        throw new Error("stored config should not be read in local E2E mode");
      },
    } as never);

    const routeKey = await service.resolveSceneRouteKey(
      "ai_novel",
      "chat",
      "kickoff_turn",
      "free",
    );
    assert.equal(routeKey, "ainovel-plus-reasoning");
  } finally {
    restoreOptionalEnv("AINOVEL_E2E_LLM_PROVIDER", previousFlag);
    restoreOptionalEnv("APP_ENV", previousAppEnv);
    restoreOptionalEnv("NODE_ENV", previousNodeEnv);
  }
});

function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
