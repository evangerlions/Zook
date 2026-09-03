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
  assert.match(systemPrompt, /Contract\.extras/);
  assert.match(systemPrompt, /author-defined requirement/);
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
  assert.match(systemPrompt, /Contract\.extras/);
  assert.match(systemPrompt, /requires needs_repair/);
  assert.match(
    systemPrompt,
    /use only Contract\.extras, plannedChecklist, story window, and draft/,
  );
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

test("import_book_agent prompt explains import submit tools", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "import_book_agent",
    messages: [],
    context: {
      stepName: "read_cold_chunk",
      expectedTools: ["submit_import_plan_update", "submit_rolling_snapshot"],
    },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "submit_import_plan_update",
    "submit_rolling_snapshot",
    "submit_chapter_summaries",
    "submit_snapshot",
    "submit_hot_handoff",
  ]);
  assert.equal(assembly.forcedToolName, undefined);
  assert.match(systemPrompt, /Extract facts faithfully/);
  assert.match(systemPrompt, /Do not use memory/);
  assert.match(systemPrompt, /submit_import_plan_update/);
  assert.match(systemPrompt, /submit_rolling_snapshot/);
  assert.match(systemPrompt, /submit_chapter_summaries/);
  assert.match(systemPrompt, /submit_hot_handoff/);
  assert.match(systemPrompt, /Call every expected submit tool/);
  assert.match(systemPrompt, /BookContract\.extras/);
  assert.match(systemPrompt, /author-defined requirements/);
});

test("imported-book kickoff prompt uses continuation tools and ready checkpoint", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "kickoff_turn_imported_book",
    locale: "zh-CN",
    messages: [{ role: "user", content: "我想改成朝堂线续写" }],
    context: {
      meta: {
        extras: {
          progression: "十章内不得揭开完整真相。",
        },
      },
    },
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  const userPrompt = String(assembly.messages[1]?.content ?? "");
  assert.deepEqual(assembly.tools.map((tool) => tool.name), [
    "read_import_result",
    "search_imported_book",
    "read_imported_chapter",
    "update_import_writing_artifacts",
    "ask_question",
    "ready",
  ]);
  assert.equal(assembly.forcedToolName, undefined);
  assert.match(systemPrompt, /imported-book kickoff agent/);
  assert.match(systemPrompt, /This is not a blank new-book kickoff/);
  assert.match(systemPrompt, /read_import_result/);
  assert.match(systemPrompt, /search_imported_book/);
  assert.match(systemPrompt, /update_import_writing_artifacts/);
  assert.match(systemPrompt, /ready continuation card/);
  assert.match(systemPrompt, /BookContract\.extras/);
  assert.match(systemPrompt, /author's durable custom requirements/);
  assert.match(systemPrompt, /adds or changes a custom requirement/);
  assert.match(systemPrompt, /existing key to null/);
  assert.match(systemPrompt, /Localized authoring glossary:/);
  assert.match(systemPrompt, /开书、开始写、正式开始/);
  assert.match(systemPrompt, /current imported writing artifacts/);
  assert.match(systemPrompt, /target chapter/);
  assert.match(systemPrompt, /call read_import_result first/);
  assert.doesNotMatch(systemPrompt, /Chapter 1 drafting/);
  assert.doesNotMatch(systemPrompt, /Do not ask what these words mean/);
  assert.doesNotMatch(
    systemPrompt,
    /Do not treat this as opening an existing book file/,
  );
  assert.match(userPrompt, /十章内不得揭开完整真相/);
  assert.doesNotMatch(userPrompt, /kickoffMode|bookId|targetChapterIndex/);
  assert.match(userPrompt, /我想改成朝堂线续写/);
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
  assert.match(systemPrompt, /Contract\.extras/);
  assert.match(systemPrompt, /author-defined requirement/);
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

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /Contract\.extras/);
  assert.match(systemPrompt, /remember, persist, add, or change/);
  assert.match(systemPrompt, /existing key to null/);
  const extras = (patch.properties as Record<string, unknown>)
    .extras as Record<string, unknown>;
  assert.match(String(extras.description ?? ""), /durable custom requirements/);
});
