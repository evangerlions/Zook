import { defineAiNovelTool, type AiNovelToolDefinition } from "../tools/ai-novel-tool-definition.ts";
import { READ_TOOL, contextReadTools, readDraftTool, storyHistoryTools } from "../tools/context-tools.ts";
import { draftTools, interactionTools, readyCheckpointTool, writeDraftTool, writeStateTools } from "../tools/writing-tools.ts";
import { bookContractSchema, importEvidenceSchema, mainLineSchema } from "../tools/writing-artifact-schemas.ts";
import { SUBMIT_CHAPTER_SUMMARIES_TOOL, SUBMIT_HOT_HANDOFF_TOOL, SUBMIT_IMPORT_PLAN_UPDATE_TOOL, SUBMIT_ROLLING_SNAPSHOT_TOOL, SUBMIT_SNAPSHOT_TOOL } from "../tools/structured-output-tools.ts";
export { SUBMIT_CHAPTER_SUMMARY_TOOL, SUBMIT_CHAPTER_REVIEW_TOOL, SUBMIT_SNAPSHOT_TOOL, SUBMIT_NEXT_CHAPTER_BRIEF_TOOL, SUBMIT_IMPORT_PLAN_UPDATE_TOOL, SUBMIT_ROLLING_SNAPSHOT_TOOL, SUBMIT_CHAPTER_SUMMARIES_TOOL, SUBMIT_HOT_HANDOFF_TOOL } from "../tools/structured-output-tools.ts";
export { READ_TOOL } from "../tools/context-tools.ts";

export const WRITE_TURN_TOOLS: AiNovelToolDefinition[] = [
  READ_TOOL,
  ...contextReadTools,
  ...interactionTools,
  ...writeStateTools,
  ...draftTools,
  ...storyHistoryTools,
];

export const HISTORY_CHAPTER_QA_TOOLS: AiNovelToolDefinition[] = [
  readDraftTool,
  ...storyHistoryTools,
];

export const LEGACY_CHAPTER_DRAFT_TOOLS: AiNovelToolDefinition[] = [
  readDraftTool,
  ...storyHistoryTools,
  writeDraftTool,
];

export const CHAPTER_DRAFT_TOOLS: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "read_writing_context",
    description: "Read the complete current Writing context in one call.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  ...LEGACY_CHAPTER_DRAFT_TOOLS,
];

export const IMPORTED_BOOK_KICKOFF_TOOLS: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "read_import_result",
    description: "Read the imported-book ready projection: canonical writing artifacts, evidence index, latest imported chapter, and target chapter preview.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  defineAiNovelTool({
    name: "search_imported_book",
    description: "Search the imported manuscript evidence by query. Return ranked snippets with chapter index/title and source refs when available.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      }
    }
  }),
  defineAiNovelTool({
    name: "read_imported_chapter",
    description: "Read one imported historical chapter by chapter index for source-grounded continuation discussion.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chapterIndex"],
      properties: {
        chapterIndex: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      }
    }
  }),
  defineAiNovelTool({
    name: "update_import_writing_artifacts",
    description: "Update the imported-book ready result after the author changes future direction, canon boundaries, next chapter entry, or near-term pressure. Submit strict full BookContract, MainLine, and ImportEvidence replacements. Only the listed canonical fields are accepted.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bookContract", "mainLine", "importEvidence", "reason"],
      properties: {
        bookContract: {
          ...bookContractSchema,
          description: "Strict full replacement BookContract for the revised imported ready result.",
        },
        mainLine: {
          ...mainLineSchema,
          description: "Strict full replacement MainLine for the revised imported ready result.",
        },
        importEvidence: {
          ...importEvidenceSchema,
          description: "Evidence supporting revised source-sensitive claims.",
        },
        evidenceRefs: {
          type: "array",
          description: "Evidence refs from read_import_result/search/read chapter supporting the update.",
          items: { type: "string" },
        },
        changedFields: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      }
    }
  }),
  ...interactionTools,
  readyCheckpointTool,
];

export const IMPORT_BOOK_AGENT_TOOLS: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "read_imported_chapter_batch",
    description: "Read the authoritative imported chapter batch attached to the current import step.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  SUBMIT_IMPORT_PLAN_UPDATE_TOOL,
  SUBMIT_ROLLING_SNAPSHOT_TOOL,
  SUBMIT_CHAPTER_SUMMARIES_TOOL,
  SUBMIT_SNAPSHOT_TOOL,
  SUBMIT_HOT_HANDOFF_TOOL,
];
