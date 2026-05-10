import assert from "node:assert/strict";
import test from "node:test";
import { buildAiNovelPromptAssembly } from "../../src/modules/ai-novel/ai-novel-llm-prompts.ts";

test("chapter_draft prompt prioritizes chapter-level execution without early payoff", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_draft",
    messages: [],
    context: {
      chapterFrame: { chapterIndex: 2 },
      currentBrief: "Keep the investigation pressure unresolved.",
    },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /Chapter execution contract/);
  assert.match(systemPrompt, /chapterFrame and currentBrief/);
  assert.match(systemPrompt, /long-term story constraints/);
  assert.match(systemPrompt, /Preserve open questions/);
  assert.match(systemPrompt, /Avoid unearned conflict resolution/);
  assert.match(systemPrompt, /history only/);
  assert.match(systemPrompt, /do not copy/);
  assert.match(systemPrompt, /latest irreversible state/);
});

test("next_chapter_brief prompt keeps compatible brief string shape", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "next_chapter_brief",
    messages: [],
    context: { targetChapterIndex: 3 },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /string field named `brief`/);
  assert.match(systemPrompt, /must advance/);
  assert.match(systemPrompt, /must not resolve yet/);
  assert.match(systemPrompt, /variation from the previous chapter/);
  assert.match(systemPrompt, /Do not include markdown fences/);
});

test("book contract tool preserves optional story anchor names", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "write_turn",
    messages: [],
  });

  const setBookContract = assembly.tools.find(
    (tool) => tool.name === "set_book_contract",
  );
  const schema = setBookContract?.inputSchema as Record<string, unknown>;
  assert.ok(schema);
  const patch = (schema.properties as Record<string, unknown>).patch as Record<
    string,
    unknown
  >;
  const storyAnchors = (patch.properties as Record<string, unknown>)
    .storyAnchors as Record<string, unknown>;
  const items = storyAnchors.items as Record<string, unknown>;
  const properties = items.properties as Record<string, unknown>;

  assert.ok(properties.name);
  assert.deepEqual(items.required, ["label", "role", "rules"]);
});
