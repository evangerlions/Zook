import { defineAiNovelTool, type AiNovelToolDefinition } from "./ai-novel-tool-definition.ts";

export const contextReadTools: AiNovelToolDefinition[] = [
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
  defineAiNovelTool({
    name: "read_book_contract",
    description: "Read the current book contract fragment.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  defineAiNovelTool({
    name: "read_main_line",
    description: "Read the current main-line fragment.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  defineAiNovelTool({
    name: "read_chapter_frame",
    description: "Read the current chapter frame.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  defineAiNovelTool({
    name: "read_story_window",
    description: "Read the default continuity window around the current chapter.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
  defineAiNovelTool({
    name: "read_current_brief",
    description: "Read the current next-chapter brief.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }),
];

export const readDraftTool = defineAiNovelTool({
  name: "read_draft",
  description: "Read a chapter draft. Defaults to the bound current chapter; pass chapterIndex to read another chapter in the same book.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      chapterIndex: { type: "integer", minimum: 1 },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 },
    }
  }
});

export const storyHistoryTools: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "search_story_history",
    description: "Search distant accepted story history by query.",
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
];

export const READ_TOOL = defineAiNovelTool({
  name: "read",
  description: "Read text from an approved virtual Skill path.",
  visibility: {
    agentProtocol: "pi-v1",
    requiresSkills: true
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Exact virtual path from the approved Skill catalog or its referenced files.",
      },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    }
  }
});
