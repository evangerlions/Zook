import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
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
  assert.match(systemPrompt, /MainLine\.sourceBeat/);
  assert.match(systemPrompt, /source of truth/);
  assert.match(systemPrompt, /concise execution note/);
  assert.match(systemPrompt, /long-term story constraints/);
  assert.match(systemPrompt, /Preserve open questions/);
  assert.match(systemPrompt, /Avoid unearned conflict resolution/);
  assert.match(systemPrompt, /explicit prohibition/);
  assert.match(systemPrompt, /forbidden payoff/);
  assert.match(systemPrompt, /sourceBeat\.forbidden/);
  assert.match(systemPrompt, /Natural-language negative preferences/);
  assert.doesNotMatch(systemPrompt, /`不要`.*hard constraints/);
  assert.match(systemPrompt, /Do not fill length by advancing/);
  assert.match(systemPrompt, /safe current-beat/);
  assert.match(systemPrompt, /target density guidance/);
  assert.doesNotMatch(systemPrompt, /target chapter-length lower bound/);
  assert.match(systemPrompt, /Aim for the target density/);
  assert.match(systemPrompt, /genre-appropriate material/);
  assert.match(systemPrompt, /character response/);
  assert.match(systemPrompt, /book's tone/);
  assert.match(systemPrompt, /Repair mode/);
  assert.match(systemPrompt, /fragments\.draft\.content/);
  assert.match(systemPrompt, /Review issues JSON/);
  assert.match(systemPrompt, /Treat review suggestions as examples, not canon/);
  assert.match(systemPrompt, /MainLine\.futureMilestones/);
  assert.match(systemPrompt, /negative constraints/);
  assert.match(systemPrompt, /power\/progression\/status changes/);
  assert.doesNotMatch(systemPrompt, /repeated medicine cooking/);
  assert.doesNotMatch(systemPrompt, /approaching footsteps/);
  assert.doesNotMatch(systemPrompt, /black shadows/);
  assert.doesNotMatch(systemPrompt, /contract signing/);
  assert.doesNotMatch(systemPrompt, /Do not create cheap suspense/);
  assert.match(systemPrompt, /distinct purpose, consequence, or later trace/);
  assert.match(systemPrompt, /empty slogans/);
  assert.match(systemPrompt, /concrete in-scene pressure/);
  assert.doesNotMatch(systemPrompt, /real test had only begun/);
  assert.match(systemPrompt, /available perception/);
  assert.match(systemPrompt, /history only/);
  assert.match(systemPrompt, /do not copy/);
  assert.match(systemPrompt, /latest irreversible state/);
  assert.match(systemPrompt, /Never expose process labels/);
  assert.match(systemPrompt, /上一章/);
  assert.match(systemPrompt, /前前章/);
  assert.match(systemPrompt, /natural story details/);
});

test("chapter_draft_review prompt does not suggest future beat fixes", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_draft_review",
    messages: [],
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_chapter_review",
  ]);
  assert.equal(assembly.forcedToolName, "submit_chapter_review");
  assert.match(systemPrompt, /call submit_chapter_review exactly once/);
  assert.match(systemPrompt, /target density guidance/);
  assert.match(systemPrompt, /not hard acceptance gates/);
  assert.match(systemPrompt, /Do not fail a chapter solely/);
  assert.match(systemPrompt, /draft\.characterCount/);
  assert.match(systemPrompt, /planned\/covered\/missed\/extra/);
  assert.match(systemPrompt, /blocking field/);
  assert.doesNotMatch(systemPrompt, /10% hard acceptance variance/);
  assert.doesNotMatch(systemPrompt, /minChars \\* 0\\.9/);
  assert.doesNotMatch(systemPrompt, /later MainLine beat/);
  assert.match(systemPrompt, /reservedFutureMilestones/);
  assert.match(systemPrompt, /power\/progression\/status changes/);
  assert.doesNotMatch(systemPrompt, /cultivation\/status changes/);
  assert.match(systemPrompt, /single source of truth/);
  assert.match(systemPrompt, /plannedChecklist\.endBoundary/);
  assert.match(systemPrompt, /current beat's unresolved consequence/);
  assert.match(systemPrompt, /current chapter boundary/);
  assert.match(systemPrompt, /storyWindow facts/);
  assert.match(systemPrompt, /key object possession\/location\/status/);
  assert.match(systemPrompt, /plausible retrieval or transfer/);
  assert.match(systemPrompt, /materially breaks the current beat/);
  assert.match(systemPrompt, /nonblocking issue/);
  assert.match(systemPrompt, /workflow\/meta language/);
  assert.match(systemPrompt, /untranslated foreign prose words/);
  assert.match(systemPrompt, /blocking mixed-language issues/);
  assert.match(systemPrompt, /上一章/);
  assert.match(systemPrompt, /前前章/);
  assert.match(systemPrompt, /natural story continuity/);
});

test("chapter_summary prompt keeps generated context in target language", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_summary",
    messages: [],
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_chapter_summary",
  ]);
  assert.equal(assembly.forcedToolName, "submit_chapter_summary");
  assert.match(systemPrompt, /call submit_chapter_summary exactly once/);
  assert.match(systemPrompt, /target writing language/);
  assert.match(systemPrompt, /Contract\.language/);
  assert.match(systemPrompt, /all fact values/);
  assert.match(systemPrompt, /objectStates/);
  assert.match(systemPrompt, /physical location/);
  assert.match(systemPrompt, /Do not infer future payoffs/);
});

test("next_chapter_brief prompt keeps compatible brief string shape", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "next_chapter_brief",
    messages: [],
    context: { targetChapterIndex: 3 },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_next_chapter_brief",
  ]);
  assert.equal(assembly.forcedToolName, "submit_next_chapter_brief");
  assert.match(systemPrompt, /string field named `brief`/);
  assert.match(systemPrompt, /taskBook/);
  assert.match(systemPrompt, /must advance/);
  assert.match(systemPrompt, /must not resolve yet/);
  assert.match(systemPrompt, /variation from the previous chapter/);
  assert.match(systemPrompt, /required\.endBoundary/);
  assert.match(systemPrompt, /required\.endBoundary/);
  assert.match(systemPrompt, /adaptedFromBeat true/);
  assert.match(systemPrompt, /Never silently rewrite/);
  assert.match(systemPrompt, /not to narrate the later journey/);
  assert.match(systemPrompt, /concrete current-chapter constraints/);
  assert.match(systemPrompt, /target writing language/);
  assert.match(systemPrompt, /Do not include markdown fences/);
});

test("snapshot_generation prompt uses a required structured output tool", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "snapshot_generation",
    messages: [],
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_snapshot",
  ]);
  assert.equal(assembly.forcedToolName, "submit_snapshot");
  assert.match(systemPrompt, /call submit_snapshot exactly once/);
});

test("import_book_agent prompt exposes step-scoped submit tools without forced choice", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "import_book_agent",
    messages: [{ role: "user", content: "Import chapters 61..64." }],
    context: {
      expectedTools: [
        "submit_import_plan_update",
        "submit_chapter_summaries",
        "submit_snapshot",
      ],
      suppliedTools: [
        "submit_import_plan_update",
        "submit_chapter_summaries",
        "submit_snapshot",
      ],
      importContext: {
        sourceRange: { startChapterIndex: 61, endChapterIndex: 64 },
      },
    },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_import_plan_update",
    "submit_chapter_summaries",
    "submit_snapshot",
  ]);
  assert.equal(assembly.forcedToolName, undefined);
  assert.match(systemPrompt, /ImportBookAgent/);
  assert.match(systemPrompt, /normal bounded agent parallel/);
  assert.match(systemPrompt, /no macro-agent or micro-agent/);
  assert.match(systemPrompt, /only source data/);
  assert.match(systemPrompt, /Do not use prior knowledge/);
  assert.match(systemPrompt, /If full chapter text is absent/);
  assert.match(systemPrompt, /## Core concepts/);
  assert.match(systemPrompt, /`Contract` is the durable book-level agreement/);
  assert.match(systemPrompt, /## How to choose tools/);
  assert.match(systemPrompt, /If `submit_import_plan_update` is supplied/);
  assert.match(systemPrompt, /If `submit_rolling_snapshot` is supplied/);
  assert.match(systemPrompt, /If `submit_chapter_summaries` is supplied/);
  assert.match(systemPrompt, /If `submit_chapter_summary` is supplied/);
  assert.match(systemPrompt, /If `submit_snapshot` is supplied/);
  assert.match(systemPrompt, /If `submit_hot_handoff` is supplied/);
  assert.match(systemPrompt, /Call every required submit tool/);
});

test("import_book_agent single chapter summary tool accepts chapterIndex", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "import_book_agent",
    messages: [],
    context: {
      expectedTools: ["submit_chapter_summary", "submit_hot_handoff"],
      suppliedTools: ["submit_chapter_summary", "submit_hot_handoff"],
    },
  });

  const summaryTool = assembly.tools.find(
    (tool) => tool.name === "submit_chapter_summary",
  );
  assert.ok(summaryTool);
  const schema = summaryTool.inputSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  assert.ok(properties.chapterIndex);
  assert.deepEqual(schema.required, ["summary"]);
});

test("next_chapter_brief scene uses light planning temperature", () => {
  const scene = resolveAiNovelChatScene("next_chapter_brief");

  assert.equal(scene.defaultTemperature, 0.15);
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
