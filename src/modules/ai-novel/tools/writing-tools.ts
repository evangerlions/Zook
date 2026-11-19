import { defineAiNovelTool, type AiNovelToolDefinition } from "./ai-novel-tool-definition.ts";
import { bookScaleSchema } from "./writing-artifact-schemas.ts";
import { readDraftTool } from "./context-tools.ts";

export const writeStateTools: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "set_book_contract",
    description: "Patch durable premise-based book contract fields.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["patch", "reason"],
      properties: {
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
                    description: "Concrete character name when this anchor represents a named character. For protagonist anchors, use the real name/alias, not pronouns such as 我/I.",
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
              description: "Patch the author's durable custom requirements. Omitted entries are preserved; set an existing key to null only when the author removes it.",
            },
            readiness: { type: "number" },
          },
        },
        reason: { type: "string" },
      }
    }
  }),
  defineAiNovelTool({
    name: "set_main_line",
    description: "Patch the user-confirmed rolling MainLine plan.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["patch", "reason"],
      properties: {
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
      }
    }
  }),
];

export const writeDraftTool = defineAiNovelTool({
  name: "write_draft",
  description: "Persist a full replacement of the bound chapter draft.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      disableMdClean: {
        type: "boolean",
        description: "Markdown cleanup is enabled by default. Set literal true only when the author explicitly requests preserving literal Markdown syntax.",
      },
    }
  }
});

export const draftTools: AiNovelToolDefinition[] = [readDraftTool, writeDraftTool];

export const interactionTools: AiNovelToolDefinition[] = [
  defineAiNovelTool({
    name: "ask_question",
    description: "Ask one focused question when user clarification is required. Options must be a real JSON array of { label, subtitle } objects, never a JSON string. This is single-select; custom input is enabled by default, so pass allowCustom=false only when custom input must be disabled.",
    visibility: {},
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "options"],
      properties: {
        question: {
          type: "string",
          description: "Complete focused question to ask the user.",
        },
        options: {
          type: "array",
          description: "Available choices as a real JSON array. Do not pass a JSON-encoded string.",
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
                description: "Short user-facing explanation shown under this option.",
              },
            },
          },
        },
        allowCustom: {
          type: "boolean",
          description: "Allow typing a custom answer. Defaults to true when omitted.",
        },
      }
    }
  }),
];

export const readyCheckpointTool = defineAiNovelTool({
  name: "ready",
  description: "Pause at the ready checkpoint when the author-facing plan is reviewable and can be used to start writing.",
  visibility: {},
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "mainLine"],
    properties: {
      summary: {
        type: "string",
        description: "Concise user-facing ready-card summary.",
      },
      mainLine: {
        type: "object",
        description: "The confirmed 6-10 chapter MainLine plan that Writing Entry Preparation will use.",
        additionalProperties: true,
      },
    }
  }
});
