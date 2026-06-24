import assert from "node:assert/strict";
import test from "node:test";
import {
  AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV,
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
      modelKeyKind: "scene_route",
      resolvedModelKey: "qwen3.6-plus",
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
  assert.ok(
    events.some(
      (event) =>
        event.type === "reasoning_delta" &&
        event.text.includes("本地 E2E 推理"),
    ),
  );

  const ready = events.find(
    (event) => event.type === "tool_call" && event.toolCall.name === "ready",
  );
  assert.ok(ready && ready.type === "tool_call");
  assert.equal(
    typeof (ready.toolCall.input.mainLine as Record<string, unknown>).summary,
    "string",
  );
});

test("local AINovel E2E provider can ask once before kickoff ready", async () => {
  const previousAskFirst = process.env[AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV];
  process.env[AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV] = "1";

  try {
    const provider = new LocalAiNovelE2eProvider();
    const firstEvents = await collectStream(
      provider.stream(kickoffRequest([{ role: "user", content: "我要写东方玄幻。" }])),
    );
    const firstToolCalls = firstEvents.filter(
      (event) => event.type === "tool_call",
    );

    assert.equal(firstToolCalls.length, 1);
    assert.equal(firstToolCalls[0].toolCall.name, "ask_question");
    assert.deepEqual(
      (firstToolCalls[0].toolCall.input.options as Array<{ label: string }>).map(
        (option) => option.label,
      ),
      ["追兵压迫", "残魂交易"],
    );

    const continuationEvents = await collectStream(
      provider.stream(
        kickoffRequest([
          { role: "user", content: "我要写东方玄幻。" },
          {
            role: "tool",
            content: "追兵压迫",
            toolCallId: "local_e2e_ask_question",
          },
        ]),
      ),
    );
    const continuationToolNames = continuationEvents
      .filter((event) => event.type === "tool_call")
      .map((event) => event.toolCall.name);

    assert.deepEqual(continuationToolNames, ["update_meta", "ready"]);
  } finally {
    restoreOptionalEnv(
      AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV,
      previousAskFirst,
    );
  }
});

test("local AINovel E2E provider returns a pass decision for content safety", async () => {
  const provider = new LocalAiNovelE2eProvider();
  const result = await provider.complete({
    model: {
      provider: "bailian",
      modelKey: "qwen3.5-flash",
      resolvedModelKey: "qwen3.5-flash",
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

test("local AINovel E2E provider exercises chapter draft reasoning replay", async () => {
  const provider = new LocalAiNovelE2eProvider();
  const firstEvents = await collectStream(
    provider.stream({
      model: {
        provider: "bailian",
        modelKey: "ainovel-plus-reasoning",
        modelKeyKind: "scene_route",
        resolvedModelKey: "qwen3.6-plus",
        providerModel: "qwen3.6-plus",
      },
      messages: [{ role: "user", content: "写第一章。" }],
      providerOptions: chapterDraftProviderOptions(),
    } satisfies ResolvedLLMCompletionRequest),
  );

  assert.ok(firstEvents.some((event) => event.type === "reasoning_delta"));
  assert.ok(firstEvents.some((event) => event.type === "content_delta"));
  assert.equal(
    firstEvents.some((event) => event.type === "tool_call"),
    false,
  );

  const retryEvents = await collectStream(
    provider.stream({
      model: {
        provider: "bailian",
        modelKey: "ainovel-plus-reasoning",
        modelKeyKind: "scene_route",
        resolvedModelKey: "qwen3.6-plus",
        providerModel: "qwen3.6-plus",
      },
      messages: [
        { role: "user", content: "写第一章。" },
        {
          role: "assistant",
          content: "沈烬听见黑骨灯轻响。",
          reasoningContent: "上一轮隐藏推理应随 assistant 历史回放。",
        },
        {
          role: "user",
          content:
            "The previous assistant turn did not call write_draft. You must now call write_draft.",
        },
      ],
      providerOptions: chapterDraftProviderOptions(),
    } satisfies ResolvedLLMCompletionRequest),
  );

  const toolCalls = retryEvents.filter((event) => event.type === "tool_call");
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].toolCall.name, "write_draft");
});

async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function chapterDraftProviderOptions(): Record<string, unknown> {
  return {
    tools: [
      {
        type: "function",
        function: { name: "write_draft" },
      },
    ],
  };
}

function kickoffRequest(
  messages: ResolvedLLMCompletionRequest["messages"],
): ResolvedLLMCompletionRequest {
  return {
    model: {
      provider: "bailian",
      modelKey: "ainovel-plus-reasoning",
      modelKeyKind: "scene_route",
      resolvedModelKey: "qwen3.6-plus",
      providerModel: "qwen3.6-plus",
    },
    messages,
    providerOptions: {
      tools: ["update_meta", "ask_question", "ready"].map((name) => ({
        type: "function",
        function: { name },
      })),
    },
  };
}

test("local AINovel E2E mode uses default scene routing without stored admin config", async () => {
  const previousFlag = process.env.AINOVEL_E2E_LLM_PROVIDER;
  const previousAppEnv = process.env.APP_ENV;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AINOVEL_E2E_LLM_PROVIDER = "1";
  process.env.APP_ENV = "local";
  process.env.NODE_ENV = "development";

  try {
    const service = new AppAiRoutingConfigService();

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
