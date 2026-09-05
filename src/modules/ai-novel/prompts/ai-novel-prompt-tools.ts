import type { LLMToolDefinition } from "../../../services/llm-manager.ts";

function scaleChoiceSchema(
  presets: string[],
  description: string,
): Record<string, unknown> {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["preset", "note"],
    properties: {
      preset: {
        type: "string",
        enum: [...presets, "custom"],
        description:
          "Fixed English preset. Use custom only when no fixed preset fits; explain custom in note.",
      },
      note: {
        type: "string",
        description:
          "Freeform note in the user's writing language; required and meaningful when preset is custom.",
      },
    },
  };
}

const chapterLengthSchema: Record<string, unknown> = {
  type: "object",
  description: "Target length for one chapter body.",
  additionalProperties: false,
  required: ["preset", "note"],
  properties: {
    preset: {
      type: "string",
      enum: ["short", "standard", "long", "extra_long", "custom"],
    },
    minChars: {
      type: "number",
      description: "Lower target body length. Number only, no units.",
    },
    maxChars: {
      type: "number",
      description: "Upper target body length. Number only, no units.",
    },
    note: {
      type: "string",
      description:
        "Freeform note in the user's writing language; required and meaningful when preset is custom.",
    },
  },
};

const bookScaleSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["length", "chapterLength", "pov", "threadDensity", "pace"],
  properties: {
    length: scaleChoiceSchema(
      ["short", "medium", "long", "epic"],
      "Book length.",
    ),
    chapterLength: chapterLengthSchema,
    pov: scaleChoiceSchema(
      ["single_pov", "dual_pov", "ensemble_pov"],
      "Narrative POV scale.",
    ),
    threadDensity: scaleChoiceSchema(
      ["single_main_thread", "main_with_subthreads", "multi_thread"],
      "Main-thread/subthread density.",
    ),
    pace: scaleChoiceSchema(["fast", "moderate", "slow_burn"], "Pacing."),
  },
};

const storyAnchorSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["label", "role", "rules"],
  properties: {
    label: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    rules: { type: "array", items: { type: "string" } },
  },
};

const bookContractSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "revisionId",
    "storyPromise",
    "storyAnchors",
    "focalization",
    "startState",
    "trigger",
    "drive",
    "pressureSources",
    "stakes",
    "worldConstraints",
    "changeHorizon",
    "scale",
    "language",
    "toneRegister",
    "extras",
    "readiness",
  ],
  properties: {
    revisionId: { type: "string" },
    storyPromise: { type: "string" },
    storyAnchors: { type: "array", items: storyAnchorSchema },
    focalization: { type: "string" },
    startState: { type: "string" },
    trigger: { type: "string" },
    drive: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "object"],
      properties: {
        mode: { type: "string" },
        object: { type: "string" },
      },
    },
    pressureSources: { type: "array", items: { type: "string" } },
    stakes: {
      type: "object",
      additionalProperties: false,
      required: ["external", "relational", "internal"],
      properties: {
        external: { type: "string" },
        relational: { type: "string" },
        internal: { type: "string" },
      },
    },
    worldConstraints: { type: "array", items: { type: "string" } },
    changeHorizon: { type: "string" },
    scale: bookScaleSchema,
    language: { type: "string" },
    toneRegister: { type: "string" },
    extras: {
      type: "object",
      description:
        "Author-defined durable custom requirements. Existing omitted entries are preserved; null removes an existing entry.",
      additionalProperties: true,
    },
    readiness: { type: "number" },
  },
};

const mainLineBeatSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "chapterIndex",
    "goal",
    "mustCover",
    "forbidden",
    "change",
    "endBoundary",
    "endingOpenQuestion",
  ],
  properties: {
    id: { type: "string" },
    chapterIndex: { type: "integer", minimum: 1 },
    goal: { type: "string" },
    mustCover: { type: "array", items: { type: "string" } },
    forbidden: { type: "array", items: { type: "string" } },
    change: { type: "string" },
    endBoundary: { type: "string" },
    endingOpenQuestion: { type: "string" },
  },
};

const mainLineSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "revisionId",
    "title",
    "summary",
    "arcPromise",
    "arcRules",
    "startChapterIndex",
    "endChapterIndex",
    "beats",
  ],
  properties: {
    revisionId: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    arcPromise: { type: "string" },
    arcRules: { type: "array", items: { type: "string" } },
    startChapterIndex: { type: "integer", minimum: 1 },
    endChapterIndex: { type: "integer", minimum: 1 },
    beats: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: mainLineBeatSchema,
    },
  },
};

const importEvidenceRefSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["id", "chapterIndex", "snippet", "sourceHash"],
  properties: {
    id: { type: "string" },
    chapterIndex: { type: "integer", minimum: 1 },
    title: { type: "string" },
    range: { type: "string" },
    snippet: { type: "string", maxLength: 240 },
    sourceHash: { type: "string" },
  },
};

const importEvidenceSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "latestImportedChapterIndex",
    "targetChapterIndex",
    "sourceCoverage",
    "refsByArtifactPath",
    "uncertainClaims",
    "forbiddenRetcons",
    "resolvedThreads",
    "activeThreads",
    "styleSignals",
  ],
  properties: {
    latestImportedChapterIndex: { type: "integer", minimum: 1 },
    targetChapterIndex: { type: "integer", minimum: 1 },
    sourceCoverage: { type: "object", additionalProperties: true },
    refsByArtifactPath: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: importEvidenceRefSchema,
      },
    },
    uncertainClaims: { type: "array", items: { type: "string" } },
    forbiddenRetcons: { type: "array", items: { type: "string" } },
    resolvedThreads: { type: "array", items: { type: "string" } },
    activeThreads: { type: "array", items: { type: "string" } },
    styleSignals: { type: "array", items: { type: "string" } },
  },
};

const contextReadTools: LLMToolDefinition[] = [
  createTool(
    "read_writing_context",
    "Read the complete current Writing context in one call.",
    {},
  ),
  createTool(
    "read_book_contract",
    "Read the current book contract fragment.",
    {},
  ),
  createTool("read_main_line", "Read the current main-line fragment.", {}),
  createTool("read_chapter_frame", "Read the current chapter frame.", {}),
  createTool(
    "read_story_window",
    "Read the default continuity window around the current chapter.",
    {},
  ),
  createTool("read_current_brief", "Read the current next-chapter brief.", {}),
];

const writeStateTools: LLMToolDefinition[] = [
  createTool(
    "set_book_contract",
    "Patch durable premise-based book contract fields.",
    {
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          storyPromise: { type: "string" },
          storyAnchors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "role", "rules"],
              properties: {
                label: { type: "string" },
                name: {
                  type: "string",
                  description:
                    "Concrete character name when this anchor represents a named character. For protagonist anchors, use the real name/alias, not pronouns such as 我/I.",
                },
                role: { type: "string" },
                rules: { type: "array", items: { type: "string" } },
              },
            },
          },
          focalization: { type: "string" },
          startState: { type: "string" },
          trigger: { type: "string" },
          drive: {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: { type: "string" },
              object: { type: "string" },
            },
          },
          pressureSources: { type: "array", items: { type: "string" } },
          stakes: {
            type: "object",
            additionalProperties: false,
            properties: {
              external: { type: "string" },
              relational: { type: "string" },
              internal: { type: "string" },
            },
          },
          worldConstraints: { type: "array", items: { type: "string" } },
          changeHorizon: { type: "string" },
          scale: {
            ...bookScaleSchema,
          },
          language: { type: "string" },
          toneRegister: { type: "string" },
          extras: {
            type: "object",
            description:
              "Patch the author's durable custom requirements. Omitted entries are preserved; set an existing key to null only when the author removes it.",
          },
          readiness: { type: "number" },
        },
      },
      reason: { type: "string" },
    },
    ["patch", "reason"],
  ),
  createTool(
    "set_main_line",
    "Patch the user-confirmed rolling MainLine plan.",
    {
      patch: {
        type: "object",
        additionalProperties: false,
        properties: {
          revisionId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          arcPromise: { type: "string" },
          arcRules: { type: "array", items: { type: "string" } },
          startChapterIndex: { type: "integer", minimum: 1 },
          endChapterIndex: { type: "integer", minimum: 1 },
          beats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "chapterIndex",
                "goal",
                "mustCover",
                "forbidden",
                "change",
                "endBoundary",
                "endingOpenQuestion",
              ],
              properties: {
                id: { type: "string" },
                chapterIndex: { type: "integer", minimum: 1 },
                goal: { type: "string" },
                mustCover: { type: "array", items: { type: "string" } },
                forbidden: { type: "array", items: { type: "string" } },
                change: { type: "string" },
                endBoundary: { type: "string" },
                endingOpenQuestion: { type: "string" },
              },
            },
          },
        },
      },
      reason: { type: "string" },
    },
    ["patch", "reason"],
  ),
];

const readDraftTool = createTool(
  "read_draft",
  "Read a chapter draft. Defaults to the bound current chapter; pass chapterIndex to read another chapter in the same book.",
  {
    chapterIndex: { type: "integer", minimum: 1 },
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
  },
);

const writeDraftTool = createTool(
  "write_draft",
  "Persist a full replacement of the bound chapter draft.",
  {
    title: { type: "string" },
    content: { type: "string" },
    disableMdClean: {
      type: "boolean",
      description:
        "Markdown cleanup is enabled by default. Set literal true only when the author explicitly requests preserving literal Markdown syntax.",
    },
  },
  ["content"],
);

const draftTools: LLMToolDefinition[] = [readDraftTool, writeDraftTool];

const interactionTools: LLMToolDefinition[] = [
  createTool(
    "ask_question",
    "Ask one focused question when user clarification is required. Options must be a real JSON array of { label, subtitle } objects, never a JSON string. This is single-select; custom input is enabled by default, so pass allowCustom=false only when custom input must be disabled.",
    {
      question: {
        type: "string",
        description: "Complete focused question to ask the user.",
      },
      options: {
        type: "array",
        description:
          "Available choices as a real JSON array. Do not pass a JSON-encoded string.",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "subtitle"],
          properties: {
            label: {
              type: "string",
              description: "Concise option display text.",
            },
            subtitle: {
              type: "string",
              description:
                "Short user-facing explanation shown under this option.",
            },
          },
        },
      },
      allowCustom: {
        type: "boolean",
        description:
          "Allow typing a custom answer. Defaults to true when omitted.",
      },
    },
    ["question", "options"],
  ),
];

const readyCheckpointTool = createTool(
  "ready",
  "Pause at the ready checkpoint when the author-facing plan is reviewable and can be used to start writing.",
  {
    summary: {
      type: "string",
      description: "Concise user-facing ready-card summary.",
    },
    mainLine: {
      type: "object",
      description:
        "The confirmed 6-10 chapter MainLine plan that Writing Entry Preparation will use.",
      additionalProperties: true,
    },
  },
  ["summary", "mainLine"],
);

const storyHistoryTools: LLMToolDefinition[] = [
  createTool(
    "search_story_history",
    "Search distant accepted story history by query.",
    {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    },
    ["query"],
  ),
];

export const SUBMIT_CHAPTER_SUMMARY_TOOL = createTool(
  "submit_chapter_summary",
  "Submit the structured chapter summary and continuity facts.",
  {
    summary: {
      type: "string",
      description: "Compact chapter summary in the target writing language.",
    },
    facts: {
      type: "object",
      description:
        "Optional durable continuity facts such as actualEvents, coveredBeatIds, deviations, unresolvedQuestions, characterStateChanges, and objectStates.",
      additionalProperties: true,
    },
  },
  ["summary"],
);

export const SUBMIT_CHAPTER_REVIEW_TOOL = createTool(
  "submit_chapter_review",
  "Submit the structured chapter draft review result.",
  {
    verdict: {
      type: "string",
      enum: ["pass", "needs_repair"],
    },
    summary: {
      type: "string",
      description: "Concise review summary in the target writing language.",
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "message", "suggestion", "blocking"],
        properties: {
          severity: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          message: { type: "string" },
          suggestion: { type: "string" },
          blocking: { type: "boolean" },
        },
      },
    },
    planned: { type: "array", items: { type: "string" } },
    covered: { type: "array", items: { type: "string" } },
    missed: { type: "array", items: { type: "string" } },
    extra: { type: "array", items: { type: "string" } },
  },
  ["verdict", "summary", "issues", "planned", "covered", "missed", "extra"],
);

export const SUBMIT_SNAPSHOT_TOOL = createTool(
  "submit_snapshot",
  "Submit the rolling long-term story snapshot.",
  {
    snapshot: {
      type: "string",
      description: "Rolling long-term story snapshot in the target language.",
    },
  },
  ["snapshot"],
);

export const SUBMIT_NEXT_CHAPTER_BRIEF_TOOL = createTool(
  "submit_next_chapter_brief",
  "Submit the structured next-chapter writing task sheet.",
  {
    brief: {
      type: "string",
      description: "Concise chapter task brief for the ChapterDraftAgent.",
    },
    taskBook: {
      type: "object",
      additionalProperties: true,
    },
    required: {
      type: "object",
      additionalProperties: true,
    },
    strategy: {
      type: "object",
      additionalProperties: true,
    },
    contextRefs: {
      type: "object",
      additionalProperties: true,
    },
    sourceBeatId: { type: "string" },
    sourcePlanRevision: { type: "string" },
    sourceBeat: {
      type: "object",
      additionalProperties: true,
    },
    adaptedFromBeat: { type: "boolean" },
    adaptationReason: { type: "string" },
  },
  ["brief"],
);

export const SUBMIT_IMPORT_PLAN_UPDATE_TOOL = createTool(
  "submit_import_plan_update",
  "Submit the current source-grounded imported-book BookContract, executable continuation MainLine, and ImportEvidence. Use this when the import step asks for plan/canon updates. These are full canonical artifact replacements, not patches.",
  {
    bookContract: {
      ...bookContractSchema,
      description:
        "Strict BookContract reconstructed from the imported manuscript. Include source-grounded durable canon, no-rewrite boundaries, style/language, and continuation constraints.",
    },
    mainLine: {
      ...mainLineSchema,
      description:
        "Strict executable MainLine for the next 10 chapters after the latest imported chapter. Do not retell imported chapters as future beats.",
    },
    importEvidence: {
      ...importEvidenceSchema,
      description:
        "Sidecar evidence refs for source-sensitive BookContract/MainLine claims. This is not a replacement planning model.",
    },
    changedFields: { type: "array", items: { type: "string" } },
    conflictNotes: { type: "array", items: { type: "string" } },
    uncertaintyNotes: { type: "array", items: { type: "string" } },
  },
  ["bookContract", "mainLine", "importEvidence"],
);

export const SUBMIT_ROLLING_SNAPSHOT_TOOL = createTool(
  "submit_rolling_snapshot",
  "Submit the rolling snapshot for a cold imported chapter chunk. Use it to compress all source text read so far, not only the latest chapter.",
  {
    snapshot: {
      type: "string",
      description:
        "Writing-useful rolling memory: current situation, character states, factions, causal chain, open/closed threads, places, objects, style constraints, and no-rewrite boundaries.",
    },
    evidence: {
      type: "array",
      description:
        "Evidence refs from the imported source text that justify the snapshot.",
      items: { type: "string" },
    },
    sourceRange: {
      type: "object",
      description: "Chapter range covered by this rolling snapshot.",
      additionalProperties: true,
    },
  },
  ["snapshot"],
);

export const SUBMIT_CHAPTER_SUMMARIES_TOOL = createTool(
  "submit_chapter_summaries",
  "Submit multiple per-chapter summaries from a recent imported batch. Use one summary item per chapter.",
  {
    summaries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["chapterIndex", "summary"],
        properties: {
          chapterIndex: { type: "integer", minimum: 1 },
          title: { type: "string" },
          summary: {
            type: "string",
            description:
              "Chapter-specific summary with concrete events and continuity facts.",
          },
          facts: {
            type: "object",
            additionalProperties: true,
          },
          evidence: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
  ["summaries"],
);

export const SUBMIT_HOT_HANDOFF_TOOL = createTool(
  "submit_hot_handoff",
  "Submit the final handoff for continuing after the latest imported chapter.",
  {
    targetChapterIndex: {
      type: "integer",
      minimum: 1,
      description: "The next chapter index the writer should open.",
    },
    handoff: {
      type: "string",
      description:
        "Concrete continuation handoff: where the story stands, what has just changed, and what the next chapter must preserve or advance.",
    },
    unresolvedThreads: {
      type: "array",
      items: { type: "string" },
    },
    characterStates: {
      type: "array",
      items: { type: "string" },
    },
    styleSignals: {
      type: "array",
      items: { type: "string" },
    },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
  },
  ["targetChapterIndex", "handoff"],
);

export const READ_TOOL = createTool(
  "read",
  "Read text from an approved virtual Skill path.",
  {
    path: {
      type: "string",
      description: "Exact virtual path from the approved Skill catalog or its referenced files.",
    },
    offset: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1 },
  },
  ["path"],
);

export const WRITE_TURN_TOOLS: LLMToolDefinition[] = [
  READ_TOOL,
  ...contextReadTools,
  ...interactionTools,
  ...writeStateTools,
  ...draftTools,
  ...storyHistoryTools,
];

export const HISTORY_CHAPTER_QA_TOOLS: LLMToolDefinition[] = [
  readDraftTool,
  ...storyHistoryTools,
];

export const LEGACY_CHAPTER_DRAFT_TOOLS: LLMToolDefinition[] = [
  readDraftTool,
  ...storyHistoryTools,
  writeDraftTool,
];

export const CHAPTER_DRAFT_TOOLS: LLMToolDefinition[] = [
  createTool(
    "read_writing_context",
    "Read the complete current Writing context in one call.",
    {},
  ),
  ...LEGACY_CHAPTER_DRAFT_TOOLS,
];

export const IMPORTED_BOOK_KICKOFF_TOOLS: LLMToolDefinition[] = [
  createTool(
    "read_import_result",
    "Read the imported-book ready projection: canonical writing artifacts, evidence index, latest imported chapter, and target chapter preview.",
    {},
  ),
  createTool(
    "search_imported_book",
    "Search the imported manuscript evidence by query. Return ranked snippets with chapter index/title and source refs when available.",
    {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    },
    ["query"],
  ),
  createTool(
    "read_imported_chapter",
    "Read one imported historical chapter by chapter index for source-grounded continuation discussion.",
    {
      chapterIndex: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
    },
    ["chapterIndex"],
  ),
  createTool(
    "update_import_writing_artifacts",
    "Update the imported-book ready result after the author changes future direction, canon boundaries, next chapter entry, or near-term pressure. Submit strict full BookContract, MainLine, and ImportEvidence replacements. Only the listed canonical fields are accepted.",
    {
      bookContract: {
        ...bookContractSchema,
        description:
          "Strict full replacement BookContract for the revised imported ready result.",
      },
      mainLine: {
        ...mainLineSchema,
        description:
          "Strict full replacement MainLine for the revised imported ready result.",
      },
      importEvidence: {
        ...importEvidenceSchema,
        description: "Evidence supporting revised source-sensitive claims.",
      },
      evidenceRefs: {
        type: "array",
        description:
          "Evidence refs from read_import_result/search/read chapter supporting the update.",
        items: { type: "string" },
      },
      changedFields: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    ["bookContract", "mainLine", "importEvidence", "reason"],
  ),
  ...interactionTools,
  readyCheckpointTool,
];

export const IMPORT_BOOK_AGENT_TOOLS: LLMToolDefinition[] = [
  SUBMIT_IMPORT_PLAN_UPDATE_TOOL,
  SUBMIT_ROLLING_SNAPSHOT_TOOL,
  SUBMIT_CHAPTER_SUMMARIES_TOOL,
  SUBMIT_SNAPSHOT_TOOL,
  SUBMIT_HOT_HANDOFF_TOOL,
];

export function createTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): LLMToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {}),
      properties,
    },
  };
}
