import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
import { buildAiNovelPromptAssembly } from "../../src/modules/ai-novel/ai-novel-llm-prompts.ts";

test("write_turn prompt requires coordinated structural story changes", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "write_turn",
    messages: [],
    context: {},
  });

  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /Structural-change protocol/);
  assert.match(systemPrompt, /central relationship\/romance/);
  assert.match(systemPrompt, /single Contract field/);
  assert.match(systemPrompt, /every affected Contract field and the MainLine/);
  assert.match(systemPrompt, /chapters 1–10/);
  assert.match(systemPrompt, /exactly one ask_question/);
  assert.match(systemPrompt, /not a catch-all memory bucket/);
  assert.match(systemPrompt, /map the request to canonical fields first/);
  assert.match(systemPrompt, /Workflow status such as ready is never/);
  assert.match(
    systemPrompt,
    /explicitly asks for a lasting custom requirement/,
  );
  assert.match(systemPrompt, /Do not store genre labels, chapter summaries/);
  assert.doesNotMatch(systemPrompt, /Skill discipline|call read with its listed location/);
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    [
      "read_writing_context",
      "read_book_contract",
      "read_main_line",
      "read_chapter_frame",
      "read_story_window",
      "read_current_brief",
      "ask_question",
      "set_book_contract",
      "set_main_line",
      "read_draft",
      "write_draft",
      "search_story_history",
    ],
  );
});

test("agent scenes expose only client-supplied tools including virtual read", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "write_turn",
    agentProtocol: "pi-v1",
    messages: [{ role: "user", content: "review continuity" }],
    context: {
      suppliedTools: ["read", "read_writing_context"],
      skills: [
        {
          name: "chapter-continuity-review",
          description: "Review continuity.",
          location: "/skills/ainovel/chapter-continuity-review/SKILL.md",
        },
      ],
    },
  });

  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["read", "read_writing_context"],
  );
  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /Skill discipline/);
  assert.match(systemPrompt, /call read with its listed location/);
  assert.equal(assembly.messages[1]?.content, "review continuity");
});

test("legacy requests never receive Skill schema or Skill instructions", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "write_turn",
    messages: [{ role: "user", content: "review continuity" }],
    context: {
      suppliedTools: ["read", "read_writing_context"],
      skills: [
        {
          name: "chapter-continuity-review",
          description: "Review continuity.",
          location: "/skills/ainovel/chapter-continuity-review/SKILL.md",
        },
      ],
    },
  });

  assert.equal(
    assembly.tools.some((tool) => tool.name === "read"),
    false,
  );
  assert.doesNotMatch(
    String(assembly.messages[0]?.content ?? ""),
    /Skill discipline|call read with its listed location/,
  );
});

test("pi-v1 keeps raw dynamic context out of provider messages", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "write_turn",
    agentProtocol: "pi-v1",
    messages: [{ role: "user", content: "review continuity" }],
    context: {
      suppliedTools: ["read", "read_writing_context"],
      skills: [
        {
          name: "chapter-continuity-review",
          description: "Review continuity.",
          location: "/skills/ainovel/chapter-continuity-review/SKILL.md",
        },
      ],
      contract: { storyPromise: "must not enter the prompt" },
      turnId: "turn_should_not_enter_the_prompt",
    },
  });

  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["read", "read_writing_context"],
  );
  assert.equal(assembly.messages.length, 2);
  assert.equal(assembly.messages[1]?.content, "review continuity");
  assert.doesNotMatch(
    assembly.messages.map((message) => message.content ?? "").join("\n"),
    /must not enter the prompt|turn_should_not_enter_the_prompt|chapter-continuity-review/,
  );
});

test("history QA is read-only and chapter draft does not expose Skills", () => {
  const history = buildAiNovelPromptAssembly({
    profile: "history_chapter_qa",
    messages: [{ role: "user", content: "What happened?" }],
    context: {
      suppliedTools: ["read", "read_draft", "search_story_history"],
    },
  });
  assert.match(String(history.messages[0]?.content ?? ""), /read-only/);
  assert.match(
    String(history.messages[0]?.content ?? ""),
    /Do not mutate Contract, MainLine, or any chapter draft/,
  );
  assert.deepEqual(
    history.tools.map((tool) => tool.name),
    ["read_draft", "search_story_history"],
  );

  const chapterDraft = buildAiNovelPromptAssembly({
    profile: "chapter_draft",
    agentProtocol: "pi-v1",
    messages: [{ role: "user", content: "Draft it." }],
    context: {
      suppliedTools: [
        "read",
        "read_writing_context",
        "read_draft",
        "search_story_history",
        "write_draft",
      ],
    },
  });
  assert.deepEqual(
    chapterDraft.tools.map((tool) => tool.name),
    ["read_writing_context", "read_draft", "search_story_history", "write_draft"],
  );
  assert.doesNotMatch(
    String(chapterDraft.messages[0]?.content ?? ""),
    /call read with its listed location/,
  );
});

test("legacy chapter draft keeps its pre-Pi tools and supplied-context prompt", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_draft",
    messages: [{ role: "user", content: "Draft it." }],
    context: {
      fragments: { draft: { title: "Draft", content: "Existing body" } },
    },
  });

  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["read_draft", "search_story_history", "write_draft"],
  );
  const systemPrompt = String(assembly.messages[0]?.content ?? "");
  assert.match(systemPrompt, /Use the supplied context/);
  assert.doesNotMatch(systemPrompt, /read_writing_context/);
});

test("chapter_draft prompt prioritizes chapter-level execution without early payoff", () => {
  const assembly = buildAiNovelPromptAssembly({
    profile: "chapter_draft",
    agentProtocol: "pi-v1",
    messages: [],
    context: {
      suppliedTools: ["read_writing_context", "write_draft"],
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
  assert.match(systemPrompt, /read_writing_context tool result/);
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["submit_chapter_review"],
  );
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["submit_chapter_summary"],
  );
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    [
      "submit_import_plan_update",
      "submit_rolling_snapshot",
      "submit_chapter_summaries",
      "submit_snapshot",
      "submit_hot_handoff",
    ],
  );
  assert.equal(assembly.forcedToolName, undefined);
  assert.match(systemPrompt, /Extract facts faithfully/);
  assert.match(systemPrompt, /Do not use memory/);
  assert.match(systemPrompt, /submit_import_plan_update/);
  assert.match(systemPrompt, /submit_rolling_snapshot/);
  assert.match(systemPrompt, /submit_chapter_summaries/);
  assert.match(systemPrompt, /submit_hot_handoff/);
  assert.match(systemPrompt, /Call every required submit tool exposed/);
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    [
      "read_import_result",
      "search_imported_book",
      "read_imported_chapter",
      "update_import_writing_artifacts",
      "ask_question",
      "ready",
    ],
  );
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
  assert.doesNotMatch(systemPrompt, /Skill discipline|call read with its listed location/);
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["submit_next_chapter_brief"],
  );
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
  assert.deepEqual(
    assembly.tools.map((tool) => tool.name),
    ["submit_snapshot"],
  );
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
  assert.match(
    systemPrompt,
    /explicitly asks for a lasting custom requirement/,
  );
  assert.match(systemPrompt, /no canonical field can represent it/);
  assert.match(systemPrompt, /existing key to null/);
  const extras = (patch.properties as Record<string, unknown>).extras as Record<
    string,
    unknown
  >;
  assert.match(String(extras.description ?? ""), /durable custom requirements/);
});
