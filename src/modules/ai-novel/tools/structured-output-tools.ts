import { defineAiNovelTool } from "./ai-novel-tool-definition.ts";
import { bookContractSchema, importEvidenceSchema, mainLineSchema } from "./writing-artifact-schemas.ts";

export const SUBMIT_CHAPTER_SUMMARY_TOOL = defineAiNovelTool({
  name: "submit_chapter_summary",
  description: "Submit the structured chapter summary and continuity facts.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "string",
        description: "Compact chapter summary in the target writing language.",
      },
      facts: {
        type: "object",
        description: "Optional durable continuity facts such as actualEvents, coveredBeatIds, deviations, unresolvedQuestions, characterStateChanges, and objectStates.",
        additionalProperties: true,
      },
    }
  }
});

export const SUBMIT_CHAPTER_REVIEW_TOOL = defineAiNovelTool({
  name: "submit_chapter_review",
  description: "Submit the structured chapter draft review result.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "issues", "planned", "covered", "missed", "extra"],
    properties: {
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
    }
  }
});

export const SUBMIT_SNAPSHOT_TOOL = defineAiNovelTool({
  name: "submit_snapshot",
  description: "Submit the rolling long-term story snapshot.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["snapshot"],
    properties: {
      snapshot: {
        type: "string",
        description: "Rolling long-term story snapshot in the target language.",
      },
    }
  }
});

export const SUBMIT_NEXT_CHAPTER_BRIEF_TOOL = defineAiNovelTool({
  name: "submit_next_chapter_brief",
  description: "Submit the structured next-chapter writing task sheet.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["brief"],
    properties: {
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
    }
  }
});

export const SUBMIT_IMPORT_PLAN_UPDATE_TOOL = defineAiNovelTool({
  name: "submit_import_plan_update",
  description: "Submit the current source-grounded imported-book BookContract, executable continuation MainLine, and ImportEvidence. Use this when the import step asks for plan/canon updates. These are full canonical artifact replacements, not patches.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["bookContract", "mainLine", "importEvidence"],
    properties: {
      bookContract: {
        ...bookContractSchema,
        description: "Strict BookContract reconstructed from the imported manuscript. Include source-grounded durable canon, no-rewrite boundaries, style/language, and continuation constraints.",
      },
      mainLine: {
        ...mainLineSchema,
        description: "Strict executable MainLine for the next 10 chapters after the latest imported chapter. Do not retell imported chapters as future beats.",
      },
      importEvidence: {
        ...importEvidenceSchema,
        description: "Sidecar evidence refs for source-sensitive BookContract/MainLine claims. This is not a replacement planning model.",
      },
      changedFields: { type: "array", items: { type: "string" } },
      conflictNotes: { type: "array", items: { type: "string" } },
      uncertaintyNotes: { type: "array", items: { type: "string" } },
    }
  }
});

export const SUBMIT_ROLLING_SNAPSHOT_TOOL = defineAiNovelTool({
  name: "submit_rolling_snapshot",
  description: "Submit the rolling snapshot for a cold imported chapter chunk. Use it to compress all source text read so far, not only the latest chapter.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["snapshot"],
    properties: {
      snapshot: {
        type: "string",
        description: "Writing-useful rolling memory: current situation, character states, factions, causal chain, open/closed threads, places, objects, style constraints, and no-rewrite boundaries.",
      },
      evidence: {
        type: "array",
        description: "Evidence refs from the imported source text that justify the snapshot.",
        items: { type: "string" },
      },
      sourceRange: {
        type: "object",
        description: "Chapter range covered by this rolling snapshot.",
        additionalProperties: true,
      },
    }
  }
});

export const SUBMIT_CHAPTER_SUMMARIES_TOOL = defineAiNovelTool({
  name: "submit_chapter_summaries",
  description: "Submit multiple per-chapter summaries from a recent imported batch. Use one summary item per chapter.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summaries"],
    properties: {
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
              description: "Chapter-specific summary with concrete events and continuity facts.",
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
    }
  }
});

export const SUBMIT_HOT_HANDOFF_TOOL = defineAiNovelTool({
  name: "submit_hot_handoff",
  description: "Submit the final handoff for continuing after the latest imported chapter.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["targetChapterIndex", "handoff"],
    properties: {
      targetChapterIndex: {
        type: "integer",
        minimum: 1,
        description: "The next chapter index the writer should open.",
      },
      handoff: {
        type: "string",
        description: "Concrete continuation handoff: where the story stands, what has just changed, and what the next chapter must preserve or advance.",
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
    }
  }
});
