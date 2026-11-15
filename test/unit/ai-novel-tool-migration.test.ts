import assert from "node:assert/strict";
import test from "node:test";
import { kickoffToolDefinitions } from "../../src/modules/ai-novel/ai-novel-kickoff-tools.ts";
import { buildAiNovelPromptAssembly, toOpenAiToolDefinitions } from "../../src/modules/ai-novel/ai-novel-llm-prompts.ts";
import { buildAiNovelCompletionRequestPlan, buildAiNovelStreamRequestPlan } from "../../src/modules/ai-novel/ai-novel-chat-request-plan.ts";
import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
import { JOB_FORCED_TOOLS } from "../../src/modules/ai-novel/prompts/ai-novel-system-prompts.ts";
import * as toolsets from "../../src/modules/ai-novel/prompts/ai-novel-prompt-tools.ts";
import type { AiNovelToolDefinition } from "../../src/modules/ai-novel/tools/ai-novel-tool-definition.ts";

const allTools = [...new Set<AiNovelToolDefinition>([
  ...kickoffToolDefinitions,
  ...Object.values(toolsets).flat(),
])];

test("all 32 existing tool variants explicitly own visibility beside their schemas", () => {
  assert.equal(allTools.length, 32);
  for (const tool of allTools) {
    assert.ok(Object.hasOwn(tool, "visibility"), tool.name);
    assert.ok(tool.description && tool.inputSchema);
    assert.equal(tool.visibility.minAppVersion, undefined);
  }
  const readyVariants = allTools.filter((tool) => tool.name === "ready");
  assert.equal(readyVariants.length, 2);
  assert.notDeepEqual(readyVariants[0]!.inputSchema, readyVariants[1]!.inputSchema);
});

test("provider serialization never sends server visibility metadata", () => {
  for (const [index, wire] of toOpenAiToolDefinitions(allTools).entries()) {
    assert.deepEqual(Object.keys(wire).sort(), ["function", "type"]);
    const definition = wire.function as Record<string, unknown>;
    assert.deepEqual(Object.keys(definition).sort(), ["description", "name", "parameters"]);
    assert.deepEqual(definition.parameters, allTools[index]!.inputSchema);
  }
});

test("forced result tools retain their server-owned contract and enforce visibility on both paths", () => {
  const scene = resolveAiNovelChatScene("chapter_summary");
  const input = { scene, messages: [{ role: "user" as const, content: "fixture" }], context: {}, agentProtocol: "pi-v1" as const };
  const original = JOB_FORCED_TOOLS.chapter_summary!;
  try {
    JOB_FORCED_TOOLS.chapter_summary = { ...original, visibility: { minAppVersion: "1.8.0" } };
    for (const build of [buildAiNovelCompletionRequestPlan, buildAiNovelStreamRequestPlan]) {
      assert.throws(() => build({ ...input, appVersion: "1.7.1" }), /does not support required tool/);
      const plan = build({ ...input, appVersion: "1.8.0" });
      const tools = plan.providerOptions?.tools as Array<{ function: { name: string } }>;
      assert.equal(tools[0]?.function.name, original.name, "forced jobs do not require suppliedTools");
    }
  } finally {
    JOB_FORCED_TOOLS.chapter_summary = original;
  }
});

test("a hidden Skill read tool does not leave instructions to call it", () => {
  const original = toolsets.READ_TOOL.visibility;
  const input = {
    profile: "write_turn" as const, agentProtocol: "pi-v1" as const, messages: [],
    context: { suppliedTools: ["read"], skills: [{ name: "fixture", description: "approved fixture", location: "/skills/fixture" }] },
  };
  try {
    toolsets.READ_TOOL.visibility = { ...original, minAppVersion: "1.8.0" };
    const hidden = buildAiNovelPromptAssembly({ ...input, appVersion: "1.7.1" });
    assert.deepEqual(hidden.tools, []);
    assert.doesNotMatch(hidden.messages[0]!.content, /## Skill discipline/);
    const visible = buildAiNovelPromptAssembly({ ...input, appVersion: "1.8.0" });
    assert.equal(visible.tools[0]?.name, "read");
    assert.match(visible.messages[0]!.content, /## Skill discipline/);
  } finally {
    toolsets.READ_TOOL.visibility = original;
  }
});
