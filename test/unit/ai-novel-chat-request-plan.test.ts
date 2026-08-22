import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiNovelCompletionRequestPlan,
  buildAiNovelStreamRequestPlan,
} from "../../src/modules/ai-novel/ai-novel-chat-request-plan.ts";
import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
import { CN_AI_ASSISTANT_IDENTITY_RESPONSE } from "../../src/modules/ai-novel/ai-novel-region-system-prompt.ts";

const USER_MESSAGES = [{ role: "user" as const, content: "你是什么大模型" }];

test("stream request plan finalizes kickoff messages and CN identity exactly once", () => {
  const plan = buildAiNovelStreamRequestPlan({
    accountRegion: "CN",
    context: { meta: { language: "简体中文" } },
    locale: "zh-CN",
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("kickoff_turn"),
  });

  assert.equal(plan.adapter, "kickoff");
  assert.equal(plan.profile, undefined);
  assert.equal(plan.providerOptions?.enable_thinking, true);
  assert.equal(plan.providerOptions?.tool_choice, "auto");
  assert.deepEqual(toolNames(plan.providerOptions), [
    "read_meta",
    "update_meta",
    "ask_question",
    "ready",
  ]);
  const systemPrompts = plan.messages.filter((message) => message.role === "system");
  assert.equal(systemPrompts.length, 1);
  assert.equal(
    countOccurrences(String(systemPrompts[0]?.content), CN_AI_ASSISTANT_IDENTITY_RESPONSE),
    1,
  );
});

test("stream request plan preserves every existing adapter and provider option branch", () => {
  const importedKickoff = buildAiNovelStreamRequestPlan({
    accountRegion: "GLOBAL",
    context: {},
    locale: "zh-CN",
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("kickoff_turn_imported_book"),
  });
  assert.equal(importedKickoff.adapter, "imported_kickoff");
  assert.equal(importedKickoff.profile, "kickoff_turn_imported_book");
  assert.equal(importedKickoff.providerOptions?.enable_thinking, true);

  const writeTurn = buildAiNovelStreamRequestPlan({
    accountRegion: "GLOBAL",
    context: {},
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("write_turn"),
  });
  assert.equal(writeTurn.adapter, "prompted");
  assert.equal(writeTurn.profile, "write_turn");
  assert.equal(writeTurn.providerOptions?.enable_thinking, true);

  const importAgent = buildAiNovelStreamRequestPlan({
    accountRegion: "GLOBAL",
    context: {},
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("import_book_agent"),
  });
  assert.equal(importAgent.adapter, "prompted");
  assert.equal(importAgent.profile, "import_book_agent");
  assert.deepEqual(importAgent.providerOptions?.stream_options, {
    first_event_timeout_ms: 120_000,
    idle_timeout_ms: 90_000,
  });

  const basic = buildAiNovelStreamRequestPlan({
    accountRegion: "GLOBAL",
    context: {},
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("chat_compaction"),
  });
  assert.equal(basic.adapter, "basic");
  assert.equal(basic.profile, undefined);
  assert.equal(basic.providerOptions, undefined);

  for (const plan of [importedKickoff, writeTurn, importAgent, basic]) {
    assert.doesNotMatch(
      plan.messages.map((message) => message.content ?? "").join("\n"),
      new RegExp(CN_AI_ASSISTANT_IDENTITY_RESPONSE),
    );
  }
});

test("completion request plan preserves forced tools and plain completion behavior", () => {
  const structured = buildAiNovelCompletionRequestPlan({
    accountRegion: "CN",
    context: {},
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("chapter_summary"),
  });
  assert.equal(structured.profile, "chapter_summary");
  assert.equal(structured.forcedToolName, "submit_chapter_summary");
  assert.equal(structured.providerOptions?.enable_thinking, true);
  assert.equal(
    countOccurrences(
      structured.messages.map((message) => message.content ?? "").join("\n"),
      CN_AI_ASSISTANT_IDENTITY_RESPONSE,
    ),
    1,
  );

  const plain = buildAiNovelCompletionRequestPlan({
    accountRegion: "GLOBAL",
    context: {},
    messages: USER_MESSAGES,
    scene: resolveAiNovelChatScene("chat_compaction"),
  });
  assert.equal(plain.profile, undefined);
  assert.equal(plain.forcedToolName, undefined);
  assert.equal(plain.providerOptions, undefined);
  assert.strictEqual(plain.messages, USER_MESSAGES);
});

function toolNames(providerOptions: Record<string, unknown> | undefined) {
  const tools = providerOptions?.tools;
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools.map((tool) =>
    String(
      (tool as { function?: { name?: unknown } }).function?.name ?? "",
    ),
  );
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}
