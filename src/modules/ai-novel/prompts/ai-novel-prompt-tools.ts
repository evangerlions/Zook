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

const contextReadTools: LLMToolDefinition[] = [
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
          extras: { type: "object" },
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

export const WRITE_TURN_TOOLS: LLMToolDefinition[] = [
  ...contextReadTools,
  ...interactionTools,
  ...writeStateTools,
  ...draftTools,
  ...storyHistoryTools,
];

export const CHAPTER_DRAFT_TOOLS: LLMToolDefinition[] = [
  readDraftTool,
  ...storyHistoryTools,
  writeDraftTool,
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
