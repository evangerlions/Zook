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
  assert.match(systemPrompt, /explicit prohibition/);
  assert.match(systemPrompt, /forbidden payoff/);
  assert.match(systemPrompt, /Do not fill length by advancing/);
  assert.match(systemPrompt, /stop at that boundary/);
  assert.match(systemPrompt, /later journey/);
  assert.match(systemPrompt, /final beat must stay at that threshold/);
  assert.match(systemPrompt, /contract signing/);
  assert.match(systemPrompt, /Do not turn an emotional relationship beat/);
  assert.match(systemPrompt, /target density guidance/);
  assert.doesNotMatch(systemPrompt, /target chapter-length lower bound/);
  assert.match(systemPrompt, /quiet setup beat/);
  assert.match(systemPrompt, /distinct scene movements/);
  assert.match(systemPrompt, /repeat cooking medicine/);
  assert.match(systemPrompt, /Aim for the target density/);
  assert.match(systemPrompt, /resource accounting/);
  assert.match(systemPrompt, /Repair mode/);
  assert.match(systemPrompt, /expand and repair that draft/);
  assert.match(systemPrompt, /time loop/);
  assert.match(systemPrompt, /repeated medicine cooking/);
  assert.match(systemPrompt, /rewrite any offending scene/);
  assert.match(systemPrompt, /High\/medium timing/);
  assert.match(systemPrompt, /review suggestion is not canon/i);
  assert.match(systemPrompt, /the boundary wins/);
  assert.match(systemPrompt, /chapter reads complete/);
  assert.match(systemPrompt, /Fix the boundary first/);
  assert.match(systemPrompt, /follow that instruction literally/);
  assert.match(systemPrompt, /later beat/);
  assert.match(systemPrompt, /advanced into a later chapter\/beat/);
  assert.match(systemPrompt, /post-boundary survival logistics/);
  assert.match(systemPrompt, /post-threshold bloodline event/);
  assert.match(systemPrompt, /End at the boundary itself/);
  assert.match(systemPrompt, /another post-boundary paragraph/);
  assert.match(systemPrompt, /key item appeared too early/);
  assert.match(systemPrompt, /duplicated sentences/);
  assert.match(systemPrompt, /empty slogan ending/);
  assert.match(systemPrompt, /concrete in-scene sensory\/action-pressure/);
  assert.match(systemPrompt, /real test had only begun/);
  assert.match(systemPrompt, /available perception/);
  assert.match(systemPrompt, /unexplained hidden watchers/);
  assert.match(systemPrompt, /history only/);
  assert.match(systemPrompt, /do not copy/);
  assert.match(systemPrompt, /latest irreversible state/);
});

test("chapter_draft_review prompt does not suggest future beat fixes", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_draft_review",
    messages: [],
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /target density guidance/);
  assert.match(systemPrompt, /not hard acceptance gates/);
  assert.match(systemPrompt, /Do not fail a chapter solely/);
  assert.doesNotMatch(systemPrompt, /10% hard acceptance variance/);
  assert.doesNotMatch(systemPrompt, /minChars \\* 0\\.9/);
  assert.match(systemPrompt, /later CurrentArcPlan beat/);
  assert.match(systemPrompt, /current beat's unresolved consequence/);
  assert.match(systemPrompt, /not from advancing later chase/);
  assert.match(systemPrompt, /Do not over-read forbidden facts/);
  assert.match(systemPrompt, /ambient genre knowledge/);
  assert.match(systemPrompt, /do not suggest magical object changes/);
  assert.match(systemPrompt, /mundane current-scene pressure/);
});

test("chapter_summary prompt keeps generated context in target language", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_summary",
    messages: [],
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /target writing language/);
  assert.match(systemPrompt, /Contract\.language/);
  assert.match(systemPrompt, /all fact values/);
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
  assert.match(systemPrompt, /required\.endBoundary/);
  assert.match(systemPrompt, /required\.endBoundary/);
  assert.match(systemPrompt, /adaptedFromBeat true/);
  assert.match(systemPrompt, /Never silently rewrite/);
  assert.match(systemPrompt, /not to narrate the later journey/);
  assert.match(systemPrompt, /Do not broaden sourceBeat\.forbidden/);
  assert.match(systemPrompt, /blanket genre ban/);
  assert.match(systemPrompt, /dormant special object/);
  assert.match(systemPrompt, /not to the object glowing/);
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
