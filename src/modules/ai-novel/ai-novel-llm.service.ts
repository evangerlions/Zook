import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type {
  LLMMessage,
  LLMManager,
  LLMToolDefinition,
  LLMToolCall,
} from "../../services/llm-manager.ts";
import type {
  EmbeddingManager,
  EmbeddingVector,
} from "../../services/embedding-manager.ts";
import {
  AppAiRoutingConfigService,
  AI_NOVEL_APP_ID,
} from "../../services/app-ai-routing-config.service.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import {
  resolveAiNovelChatScene,
  resolveAiNovelEmbeddingScene,
} from "./ai-novel-llm-scenes.ts";
import {
  buildAiNovelPromptAssembly,
  toOpenAiToolDefinitions,
} from "./ai-novel-llm-prompts.ts";
import type { AiNovelPromptProfile } from "./ai-novel-llm-prompts.ts";

interface KickoffMeta {
  titleCandidate: string;
  readiness: number;
  storyPromise: string;
  storyAnchors: StoryAnchor[];
  focalization: string;
  startState: string;
  trigger: string;
  drive: KickoffDrive;
  pressureSources: string[];
  stakes: KickoffStakes;
  worldConstraints: string[];
  changeHorizon: string;
  premiseScale: KickoffScale;
  language: string;
  toneRegister: string;
  extras: Record<string, unknown>;
}

interface StoryAnchor {
  label: string;
  role: string;
  rules: string[];
}

interface KickoffDrive {
  mode: string;
  object: string;
}

interface KickoffStakes {
  external: string;
  relational: string;
  internal: string;
}

interface KickoffScale {
  length: KickoffScaleChoice;
  chapterLength: KickoffChapterLength;
  pov: KickoffScaleChoice;
  threadDensity: KickoffScaleChoice;
  pace: KickoffScaleChoice;
}

interface KickoffScaleChoice {
  preset: string;
  note: string;
}

interface KickoffChapterLength {
  preset: string;
  minChars?: number;
  maxChars?: number;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const kickoffToolWireNames = {
  readMeta: "read_meta",
  updateMeta: "update_meta",
  askQuestion: "ask_question",
  ready: "ready",
} as const;

const kickoffAskQuestionRuntimeOptionLimit = 6;
const kickoffScalePresetCustom = "custom";
const kickoffScaleLengthPresets = new Set([
  "short",
  "medium",
  "long",
  "epic",
  kickoffScalePresetCustom,
]);
const kickoffChapterLengthPresets = new Set([
  "short",
  "standard",
  "long",
  "extra_long",
  kickoffScalePresetCustom,
]);
const kickoffPovPresets = new Set([
  "single_pov",
  "dual_pov",
  "ensemble_pov",
  kickoffScalePresetCustom,
]);
const kickoffThreadDensityPresets = new Set([
  "single_main_thread",
  "main_with_subthreads",
  "multi_thread",
  kickoffScalePresetCustom,
]);
const kickoffPacePresets = new Set([
  "fast",
  "moderate",
  "slow_burn",
  kickoffScalePresetCustom,
]);

type KickoffToolKind =
  (typeof kickoffToolWireNames)[keyof typeof kickoffToolWireNames];

interface KickoffToolNormalizationDiagnostics {
  toolName: string;
  toolCallId: string;
  reasons: string[];
  originalInput: Record<string, unknown>;
  normalizedInput?: Record<string, unknown>;
  toolDefinition?: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
}

type KickoffToolNormalizationResult =
  | {
      toolCall: LLMToolCall;
      diagnostics?: KickoffToolNormalizationDiagnostics;
    }
  | {
      toolCall?: undefined;
      diagnostics: KickoffToolNormalizationDiagnostics;
    };

interface KickoffQuestionOptionNormalization {
  options: string[];
  optionSubtitles: string[];
  reasons: string[];
}

interface KickoffQuestionOptionItem {
  label: string;
  subtitle: string;
  kind: "object" | "string";
}

interface KickoffTurnAttempt {
  assistantText: string;
  reasoningText: string;
  usage?: AiNovelUsagePayload;
  finishReason?: string;
  toolCalls: LLMToolCall[];
  previewChunks: AiNovelChatStreamChunk[];
}

interface KickoffInvalidToolRepair {
  failedToolCall: LLMToolCall;
  diagnostics: KickoffToolNormalizationDiagnostics;
}

type KickoffAttemptFinalization =
  | {
      type: "success";
      chunks: AiNovelChatStreamChunk[];
    }
  | {
      type: "error";
      code: "KICKOFF_TOOL_UNKNOWN" | "KICKOFF_TOOL_INVALID_PAYLOAD";
      chunks: AiNovelChatStreamChunk[];
      diagnostics?:
        | KickoffToolNormalizationDiagnostics
        | Record<string, unknown>;
    }
  | {
      type: "repair";
      repair: KickoffInvalidToolRepair;
    };

const kickoffToolKindByWireName = new Map<string, KickoffToolKind>(
  Object.values(kickoffToolWireNames).map((name) => [name, name]),
);

const kickoffToolKindByLowerWireName = new Map<string, KickoffToolKind>(
  Object.values(kickoffToolWireNames).map((name) => [name.toLowerCase(), name]),
);

const kickoffInvalidToolName = "invalid";

function kickoffScaleChoiceSchema(
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
        enum: presets,
        description:
          "Canonical fixed English preset. Use custom only when no fixed preset fits; do not invent new preset strings.",
      },
      note: {
        type: "string",
        description:
          "Freeform explanation in the user's writing language. Required and meaningful when preset is custom; otherwise keep concise.",
      },
    },
  };
}

const kickoffChapterLengthSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Target length for one chapter body. This constrains draft generation; title/volume title are not counted.",
  additionalProperties: false,
  required: ["preset", "note"],
  properties: {
    preset: {
      type: "string",
      enum: [...kickoffChapterLengthPresets],
      description:
        "Canonical fixed English chapter-length preset. custom is a fixed value, not a free-text slot.",
    },
    minChars: {
      type: "number",
      description:
        "Lower bound for target chapter body length. Number only, no units.",
    },
    maxChars: {
      type: "number",
      description:
        "Upper bound for target chapter body length. Number only, no units.",
    },
    note: {
      type: "string",
      description:
        "Freeform explanation in the user's writing language. Required and meaningful when preset is custom; otherwise keep concise.",
    },
  },
};

const kickoffPremiseScaleSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Real JSON object for book scale. Use fixed English presets plus note; never put free text directly in preset.",
  additionalProperties: false,
  required: ["length", "chapterLength", "pov", "threadDensity", "pace"],
  properties: {
    length: kickoffScaleChoiceSchema(
      [...kickoffScaleLengthPresets],
      "Overall book length scale.",
    ),
    chapterLength: kickoffChapterLengthSchema,
    pov: kickoffScaleChoiceSchema(
      [...kickoffPovPresets],
      "Narrative POV scale.",
    ),
    threadDensity: kickoffScaleChoiceSchema(
      [...kickoffThreadDensityPresets],
      "Main-thread/subthread density.",
    ),
    pace: kickoffScaleChoiceSchema([...kickoffPacePresets], "Story pacing."),
  },
};

const kickoffToolDefinitions: LLMToolDefinition[] = [
  {
    name: kickoffToolWireNames.readMeta,
    description:
      "Read the full current kickoff premise draft. Call with an empty object `{}` and no arguments.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: kickoffToolWireNames.updateMeta,
    description:
      "Patch one or more fields in the current kickoff premise draft. Arrays must be real JSON arrays and objects must be real JSON objects, never strings containing JSON.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleCandidate: {
          type: "string",
          description:
            "Concrete candidate book title. Never use placeholders such as 待定书名, Untitled, or TBD.",
        },
        readiness: {
          type: "number",
          description: "Conservative readiness score from 0 to 1.",
        },
        storyPromise: {
          type: "string",
          description:
            "The durable reader-facing promise/core appeal of the book.",
        },
        storyAnchors: {
          type: "array",
          description:
            "Real JSON array of durable story anchors. Anchors can be a protagonist, protagonist group, central relationship, mystery, pressure source, or story stage. This is not a character database.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "role", "rules"],
            properties: {
              label: {
                type: "string",
                description:
                  "Concise anchor name in the user's writing language, e.g. the protagonist name, protagonist group, central relationship, core mystery, or main stage.",
              },
              role: {
                type: "string",
                description:
                  "Free-text anchor role in the user's writing language. Do not use a fixed taxonomy; write the role naturally for this book.",
              },
              rules: {
                type: "array",
                description:
                  "Durable rules or constraints for this anchor; keep 1-5 concise items.",
                items: { type: "string" },
              },
            },
          },
        },
        focalization: {
          type: "string",
          description: "Narrative viewpoint/information limit.",
        },
        startState: {
          type: "string",
          description: "The protagonist/world state before the trigger.",
        },
        trigger: {
          type: "string",
          description: "The concrete event that starts the story movement.",
        },
        drive: {
          type: "object",
          description:
            "Real JSON object describing what the protagonist/story is trying to do.",
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              description:
                "Free-text drive mode, for example discover, escape, protect, repair, survive, or a more specific phrase.",
            },
            object: {
              type: "string",
              description: "The concrete target or problem being pursued.",
            },
          },
        },
        pressureSources: {
          type: "array",
          description:
            "Real JSON array of external/relational/internal forces pressing on the story.",
          items: { type: "string" },
        },
        stakes: {
          type: "object",
          description:
            "Real JSON object describing what is at risk on external, relational, and internal layers.",
          additionalProperties: false,
          properties: {
            external: { type: "string", description: "External/world risk." },
            relational: {
              type: "string",
              description: "Relationship/social risk.",
            },
            internal: { type: "string", description: "Inner/moral risk." },
          },
        },
        worldConstraints: {
          type: "array",
          description:
            "Real JSON array of hard world/genre/rule constraints the engine must preserve.",
          items: { type: "string" },
        },
        changeHorizon: {
          type: "string",
          description: "The expected long-range transformation arc.",
        },
        premiseScale: {
          ...kickoffPremiseScaleSchema,
        },
        language: {
          type: "string",
          description: "Language used by the user in kickoff chat.",
        },
        toneRegister: {
          type: "string",
          description: "Tone/register/style constraints inferred from chat.",
        },
        extras: {
          type: "object",
          description:
            "Real JSON object for rare extra premise facts that do not fit canonical fields.",
        },
      },
    },
  },
  {
    name: kickoffToolWireNames.askQuestion,
    description:
      "Ask the user one focused kickoff question. Use this to gather preferences, clarify ambiguous premise details, or offer concrete directions. `options` must be a real JSON array of option objects with `label` and `subtitle`, never a string containing JSON.",
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
            "Allow typing a custom answer. Defaults to true when omitted; pass false only when custom input must be disabled.",
        },
      },
    },
  },
  {
    name: kickoffToolWireNames.ready,
    description:
      "Declare the kickoff sufficient to start writing and provide one user-facing book summary for the ready card.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: {
          type: "string",
          description:
            "A concise natural-language description of what this book is like. This is shown on the ready card; it is not a contract field.",
        },
      },
    },
  },
];

const KICKOFF_SYSTEM_PROMPT = [
  "You are the kickoff-mode novel setup assistant.",
  "",
  "## Role",
  "- Speak naturally in assistant content.",
  "- Use tools for structure, not for exposing internal workflow.",
  "- Never mention tool names or internal reasoning to the user.",
  "",
  "## Core objective",
  "- Progressively clarify the book idea.",
  "- Keep the kickoff card coherent and conservative.",
  "- Every turn should improve the necessary information required to start the novel.",
  "- Treat kickoff as the process of filling the Premise/Contract fields.",
  "- In most turns, continue by asking the next focused question.",
  "- Ask only the next blocking question.",
  "- Call ready only when the book is genuinely startable.",
  "",
  "## Workflow discipline",
  "1. Infer from the current conversation and summary first.",
  "2. If state may be incomplete or stale, call read_meta before deciding.",
  "3. In a single turn, you may call multiple tools when that helps you refresh state and then take the next structured step.",
  "4. When stable structured information becomes clear, call update_meta.",
  "5. In most turns, if any necessary information is still missing, continue with exactly one focused ask_question.",
  "6. If no structured follow-up is needed, assistant-only freeform continuation is allowed.",
  "7. Call ready only when titleCandidate, storyPromise, storyAnchors, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, and toneRegister are sufficiently clear.",
  "8. If the user says you may decide or start directly, infer sensible defaults from the conversation, call update_meta with every required canonical field first, then call ready only after those fields are non-empty.",
  "",
  "## Question rules",
  "- Ask one question at a time.",
  "- Offer 2 to 4 concrete, user-facing, mutually distinguishable options.",
  "- When calling ask_question, pass `question` and `options` directly.",
  "- `options` must be a real JSON array of objects shaped as { label, subtitle }, never a JSON-encoded string.",
  "- Do not add multiple-selection fields; kickoff choices are single-select.",
  "- Do not add catch-all options such as Other or 还没想好 when allowCustom can cover custom input.",
  "- Keep each option label concise and put the explanation in subtitle.",
  "- Do not ask broad questionnaires.",
  "- Do not ask for information already clear from the conversation or summary.",
  "",
  "## Tool payload rules",
  "- Follow each tool schema exactly.",
  "- Never pass arrays or objects as strings containing JSON.",
  "- For update_meta, array fields such as storyAnchors, pressureSources, and worldConstraints must be real arrays.",
  "- For update_meta, object fields such as drive, stakes, premiseScale, and extras must be real objects.",
  "- For premiseScale, use only the fixed English preset values from the tool schema.",
  "- `custom` is a fixed preset string, not a place for free text. If a scale dimension needs custom handling, set preset to `custom` and explain it in `note`.",
  "- `chapterLength.minChars` and `chapterLength.maxChars` must be plain numbers without units. If the user did not specify chapter length, choose a reasonable range from genre/platform convention.",
  "- Use the user's writing language for all free-text premise fields, storyAnchors labels/roles/rules, ready summary, and premiseScale notes, but keep preset values in English.",
  "",
  "## Meta rules",
  "- Update only fields that are more certain now.",
  "- Use canonical premise fields as the durable contract: storyPromise, storyAnchors, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, toneRegister, extras.",
  "- storyAnchors are long-term story roots, not a full character list. Use them to prevent drift around the protagonist or protagonist group, central relationship, core mystery, durable pressure source, or core stage.",
  "- Use titleCandidate only for the candidate book title; the client derives kickoff card UI text from the canonical premise.",
  "- Before ready, titleCandidate must be a concrete book title you generated or refined from the conversation.",
  "- Never use placeholder titles such as 待定书名, 暂定书名, Untitled, TBD, or AI 正在为这本书起名.",
  "- Do not speculate.",
  "- Keep readiness conservative.",
  "- Do not inflate readiness just because the idea sounds promising.",
  "",
  "## Ready rules",
  "- Do not call ready early.",
  "- Use ready only when the canonical premise/contract fields are sufficiently clear to start writing.",
  "- Do not call ready until titleCandidate is concrete and non-placeholder.",
  "- When calling ready, include summary: one polished natural-language paragraph describing what this book is like for the ready card.",
  "- Never call ready with empty placeholder contract fields.",
  "",
  "## Output rules",
  "- Never output JSON in assistant content.",
  "- Never mention tool names to the user.",
  "- Speak naturally and keep the user moving forward.",
].join("\n");

export interface AiNovelChatResponse {
  taskType: string;
  completion: {
    modelKey: string;
    provider: string;
    providerModel: string;
    content: string;
    finishReason?: string;
    providerRequestId?: string;
  };
}

interface AiNovelUsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
}

export type AiNovelChatStreamChunk =
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "tool_call";
      toolCall: {
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
    }
  | {
      type: "error";
      payload: {
        code: string;
        message: string;
        recoverable: boolean;
        details?: Record<string, unknown>;
      };
    }
  | {
      type: "reasoning_delta";
      text: string;
    }
  | {
      type: "content_delta";
      text: string;
    }
  | {
      type: "usage";
      usage: AiNovelUsagePayload;
    }
  | {
      type: "done";
      completion: {
        modelKey: string;
        content: string;
        reasoningText?: string;
        finishReason?: string;
      };
      usage?: AiNovelUsagePayload;
    };

export interface AiNovelEmbeddingsResponse {
  taskType: string;
  modelKey: string;
  provider: string;
  providerModel: string;
  vectors: EmbeddingVector[];
  providerRequestId?: string;
}

export class AiNovelLlmService {
  constructor(
    private readonly llmManager: LLMManager,
    private readonly embeddingManager: EmbeddingManager,
    private readonly appAiRoutingConfigService: AppAiRoutingConfigService,
    private readonly logger?: StructuredLogger,
  ) {}

  async createChatCompletion(
    body: Record<string, unknown>,
  ): Promise<AiNovelChatResponse> {
    if (body.model !== undefined) {
      badRequest(
        "REQ_INVALID_BODY",
        "model is not allowed. Use taskType to select the server-side scene.",
      );
    }

    const taskType = this.requireTaskType(body);
    const scene = resolveAiNovelChatScene(taskType);
    if (scene.taskType === "kickoff_turn") {
      badRequest("REQ_INVALID_BODY", "kickoff_turn requires stream=true.");
    }
    if (scene.requiresStream) {
      badRequest("REQ_INVALID_BODY", `${scene.taskType} requires stream=true.`);
    }
    const modelKey = await this.appAiRoutingConfigService.resolveModelKey(
      AI_NOVEL_APP_ID,
      "chat",
      scene.taskType,
      "free",
    );
    const messages = this.normalizeMessages(body.messages);
    const promptAssembly = scene.profile
      ? buildAiNovelPromptAssembly({
          profile: scene.profile,
          messages,
          context: body.context,
        })
      : { messages, tools: [] };
    const temperature =
      this.optionalNumber(body.temperature, "temperature") ??
      scene.defaultTemperature;
    const maxTokens =
      this.optionalPositiveInteger(body.maxTokens, "maxTokens") ??
      scene.defaultMaxTokens;
    try {
      const result = await this.llmManager.complete({
        modelKey,
        messages: promptAssembly.messages,
        temperature,
        maxTokens,
        ...(promptAssembly.tools.length > 0
          ? {
              providerOptions: {
                tools: toOpenAiToolDefinitions(promptAssembly.tools),
                tool_choice: "auto",
              },
            }
          : {}),
      });

      const response: AiNovelChatResponse = {
        taskType: scene.taskType,
        completion: {
          modelKey: result.modelKey,
          provider: result.provider,
          providerModel: result.providerModel,
          content: result.text,
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.providerRequestId
            ? { providerRequestId: result.providerRequestId }
            : {}),
        },
      };
      return response;
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  async *createChatCompletionStream(
    body: Record<string, unknown>,
  ): AsyncIterable<AiNovelChatStreamChunk> {
    if (body.model !== undefined) {
      badRequest(
        "REQ_INVALID_BODY",
        "model is not allowed. Use taskType to select the server-side scene.",
      );
    }

    const taskType = this.requireTaskType(body);
    const scene = resolveAiNovelChatScene(taskType);
    if (scene.supportsStream === false) {
      badRequest(
        "REQ_INVALID_BODY",
        `${scene.taskType} requires stream=false.`,
      );
    }
    const modelKey = await this.appAiRoutingConfigService.resolveModelKey(
      AI_NOVEL_APP_ID,
      "chat",
      scene.taskType,
      "free",
    );
    const messages = this.normalizeMessages(body.messages);
    const temperature =
      this.optionalNumber(body.temperature, "temperature") ??
      scene.defaultTemperature;
    const maxTokens =
      this.optionalPositiveInteger(body.maxTokens, "maxTokens") ??
      scene.defaultMaxTokens;
    if (scene.taskType === "kickoff_turn") {
      yield* this.createKickoffTurnStream({
        modelKey,
        messages,
        temperature,
        maxTokens,
        meta: this.normalizeKickoffMetaContext(body.context),
      });
      return;
    }
    if (scene.profile) {
      yield* this.createPromptedSceneStream({
        modelKey,
        messages,
        temperature,
        maxTokens,
        context: body.context,
        profile: scene.profile,
      });
      return;
    }

    let aggregatedContent = "";
    let aggregatedReasoning = "";
    let finishReason: string | undefined;
    let usage: AiNovelUsagePayload | undefined;

    try {
      for await (const event of this.llmManager.stream({
        modelKey,
        messages,
        temperature,
        maxTokens,
      })) {
        if (event.type === "reasoning_delta") {
          aggregatedReasoning += event.text;
          yield {
            type: "reasoning_delta",
            text: event.text,
          };
          continue;
        }

        if (event.type === "content_delta") {
          aggregatedContent += event.text;
          yield {
            type: "content_delta",
            text: event.text,
          };
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          yield {
            type: "usage",
            usage: event.usage,
          };
          continue;
        }

        finishReason = event.finishReason;
        yield {
          type: "done",
          completion: {
            modelKey,
            content: aggregatedContent,
            ...(aggregatedReasoning
              ? { reasoningText: aggregatedReasoning }
              : {}),
            ...(finishReason ? { finishReason } : {}),
          },
          ...(usage ? { usage } : {}),
        };
      }
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  private async *createPromptedSceneStream(input: {
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    context: unknown;
    profile: AiNovelPromptProfile;
  }): AsyncIterable<AiNovelChatStreamChunk> {
    let aggregatedContent = "";
    let aggregatedReasoning = "";
    let finishReason: string | undefined;
    let usage: AiNovelUsagePayload | undefined;
    const promptAssembly = buildAiNovelPromptAssembly({
      profile: input.profile,
      messages: input.messages,
      context: input.context,
    });

    try {
      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages: promptAssembly.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        providerOptions: {
          tools: toOpenAiToolDefinitions(promptAssembly.tools),
          tool_choice: "auto",
        },
      })) {
        if (event.type === "reasoning_delta") {
          aggregatedReasoning += event.text;
          yield {
            type: "reasoning_delta",
            text: event.text,
          };
          continue;
        }

        if (event.type === "content_delta") {
          aggregatedContent += event.text;
          yield {
            type: "content_delta",
            text: event.text,
          };
          continue;
        }

        if (event.type === "tool_call") {
          yield {
            type: "tool_call",
            toolCall: event.toolCall,
          };
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          yield {
            type: "usage",
            usage: event.usage,
          };
          continue;
        }

        finishReason = event.finishReason;
        yield {
          type: "done",
          completion: {
            modelKey: input.modelKey,
            content: aggregatedContent,
            ...(aggregatedReasoning
              ? { reasoningText: aggregatedReasoning }
              : {}),
            ...(finishReason ? { finishReason } : {}),
          },
          ...(usage ? { usage } : {}),
        };
      }
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  private async *createKickoffTurnStream(input: {
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    meta: KickoffMeta;
  }): AsyncIterable<AiNovelChatStreamChunk> {
    const baseMessages = this.buildKickoffMessages(input.messages, input.meta);
    const firstAttempt = await this.runKickoffTurnAttempt({
      ...input,
      messages: baseMessages,
    });
    const firstFinalization = this.finalizeKickoffTurnAttempt({
      modelKey: input.modelKey,
      attempt: firstAttempt,
      attemptNumber: 1,
      allowRepair: true,
    });

    if (firstFinalization.type !== "repair") {
      yield* this.yieldKickoffChunks(firstFinalization.chunks);
      return;
    }

    const repair = firstFinalization.repair;
    this.logger?.warn("ai_novel kickoff invalid tool repair scheduled", {
      taskType: "kickoff_turn",
      attempt: 1,
      toolName: repair.failedToolCall.name,
      toolCallId: repair.failedToolCall.id,
      reasons: repair.diagnostics.reasons,
      originalInput: repair.diagnostics.originalInput,
    });

    const secondAttempt = await this.runKickoffTurnAttempt({
      ...input,
      messages: [
        ...baseMessages,
        this.buildKickoffInvalidToolAssistantMessage(
          firstAttempt,
          repair.failedToolCall,
          repair.diagnostics,
        ),
        this.buildKickoffInvalidToolResultMessage(
          repair.failedToolCall.id,
          repair.diagnostics,
        ),
      ],
    });
    const repairedAttempt: KickoffTurnAttempt = {
      ...secondAttempt,
      usage: this.mergeKickoffUsage(firstAttempt.usage, secondAttempt.usage),
    };
    const secondFinalization = this.finalizeKickoffTurnAttempt({
      modelKey: input.modelKey,
      attempt: repairedAttempt,
      attemptNumber: 2,
      allowRepair: false,
    });
    if (secondFinalization.type === "success") {
      this.logger?.warn("ai_novel kickoff invalid tool repair recovered", {
        taskType: "kickoff_turn",
        attempt: 2,
        toolName: repair.failedToolCall.name,
        toolCallId: repair.failedToolCall.id,
        reasons: repair.diagnostics.reasons,
        originalInput: repair.diagnostics.originalInput,
      });
    } else {
      this.logger?.warn("ai_novel kickoff invalid tool repair exhausted", {
        taskType: "kickoff_turn",
        attempt: 2,
        toolName: repair.failedToolCall.name,
        toolCallId: repair.failedToolCall.id,
        reasons: repair.diagnostics.reasons,
        originalInput: repair.diagnostics.originalInput,
      });
    }
    yield* this.yieldKickoffChunks(secondFinalization.chunks);
  }

  private async runKickoffTurnAttempt(input: {
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
  }): Promise<KickoffTurnAttempt> {
    let assistantText = "";
    let reasoningText = "";
    let usage: AiNovelUsagePayload | undefined;
    let finishReason: string | undefined;
    const toolCalls: LLMToolCall[] = [];
    const previewChunks: AiNovelChatStreamChunk[] = [];

    try {
      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        providerOptions: {
          enable_thinking: true,
          tools: kickoffToolDefinitions.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: "auto",
        },
      })) {
        if (event.type === "reasoning_delta") {
          reasoningText += event.text;
          previewChunks.push({
            type: "reasoning_delta",
            text: event.text,
          });
          continue;
        }

        if (event.type === "content_delta") {
          assistantText += event.text;
          previewChunks.push({
            type: "text_delta",
            text: event.text,
          });
          continue;
        }

        if (event.type === "usage") {
          usage = event.usage;
          continue;
        }

        if (event.type === "tool_call") {
          toolCalls.push(event.toolCall);
          continue;
        }

        finishReason = event.finishReason;
      }
    } catch (error) {
      throw this.mapUpstreamError(error);
    }

    return {
      assistantText,
      reasoningText,
      usage,
      finishReason,
      toolCalls,
      previewChunks,
    };
  }

  private finalizeKickoffTurnAttempt(input: {
    modelKey: string;
    attempt: KickoffTurnAttempt;
    attemptNumber: number;
    allowRepair: boolean;
  }): KickoffAttemptFinalization {
    const chunks: AiNovelChatStreamChunk[] = [...input.attempt.previewChunks];

    for (const [index, toolCall] of input.attempt.toolCalls.entries()) {
      const normalizedToolCallId =
        toolCall.id && toolCall.id.trim().length > 0
          ? toolCall.id.trim()
          : `${input.modelKey}_kickoff_tool_${index}`;
      const toolNameResolution = this.resolveKickoffToolName({
        attempt: input.attemptNumber,
        toolName: toolCall.name,
        toolCallId: normalizedToolCallId,
        originalInput: toolCall.input,
      });
      const toolKind = toolNameResolution.toolKind;
      if (!toolKind) {
        const details: Record<string, unknown> = {
          toolName: toolCall.name,
          toolCallId: normalizedToolCallId,
          originalInput: toolCall.input,
          availableTools: Object.values(kickoffToolWireNames),
        };
        this.logger?.warn("ai_novel kickoff unknown tool rejected", {
          taskType: "kickoff_turn",
          ...details,
        });
        chunks.push({
          type: "error",
          payload: {
            code: "KICKOFF_TOOL_UNKNOWN",
            message: `Unknown kickoff tool: ${toolCall.name}`,
            recoverable: false,
            details,
          },
        });
        this.appendKickoffAttemptUsageAndDone(
          chunks,
          input.modelKey,
          input.attempt,
        );
        return {
          type: "error",
          code: "KICKOFF_TOOL_UNKNOWN",
          chunks,
          diagnostics: details,
        };
      }
      const normalizedName = toolNameResolution.normalizedToolName ?? toolCall.name;
      const normalization = this.normalizeKickoffToolCall(
        {
          id: normalizedToolCallId,
          name: normalizedName,
          input: toolCall.input,
        },
        toolKind,
      );
      const normalizedToolCall = normalization.toolCall;
      if (!normalizedToolCall) {
        if (input.allowRepair) {
          return {
            type: "repair",
            repair: {
              failedToolCall: {
                id: normalizedToolCallId,
                name: normalizedName,
                input: toolCall.input,
              },
              diagnostics: normalization.diagnostics,
            },
          };
        }
        chunks.push({
          type: "error",
          payload: {
            code: "KICKOFF_TOOL_INVALID_PAYLOAD",
            message: `Invalid kickoff tool payload: ${normalizedName}`,
            recoverable: true,
            details: normalization.diagnostics,
          },
        });
        this.appendKickoffAttemptUsageAndDone(
          chunks,
          input.modelKey,
          input.attempt,
        );
        return {
          type: "error",
          code: "KICKOFF_TOOL_INVALID_PAYLOAD",
          chunks,
          diagnostics: normalization.diagnostics,
        };
      }
      chunks.push({
        type: "tool_call",
        toolCall: {
          id: normalizedToolCall.id,
          name: normalizedToolCall.name,
          input: normalizedToolCall.input,
        },
      });
    }

    this.appendKickoffAttemptUsageAndDone(chunks, input.modelKey, input.attempt);
    return { type: "success", chunks };
  }

  private appendKickoffAttemptUsageAndDone(
    chunks: AiNovelChatStreamChunk[],
    modelKey: string,
    attempt: KickoffTurnAttempt,
  ): void {
    if (attempt.usage) {
      chunks.push({
        type: "usage",
        usage: attempt.usage,
      });
    }
    chunks.push({
      type: "done",
      completion: {
        modelKey,
        content: attempt.assistantText,
        ...(attempt.reasoningText ? { reasoningText: attempt.reasoningText } : {}),
        ...(attempt.finishReason ? { finishReason: attempt.finishReason } : {}),
      },
      ...(attempt.usage ? { usage: attempt.usage } : {}),
    });
  }

  private async *yieldKickoffChunks(
    chunks: AiNovelChatStreamChunk[],
  ): AsyncIterable<AiNovelChatStreamChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  private resolveKickoffToolName(input: {
    attempt: number;
    toolName: string;
    toolCallId: string;
    originalInput: Record<string, unknown>;
  }): {
    toolKind?: KickoffToolKind;
    normalizedToolName?: KickoffToolKind;
  } {
    const directKind = kickoffToolKindByWireName.get(input.toolName);
    if (directKind) {
      return { toolKind: directKind, normalizedToolName: directKind };
    }
    const lowerKind = kickoffToolKindByLowerWireName.get(
      input.toolName.toLowerCase(),
    );
    if (!lowerKind) {
      return {};
    }
    this.logger?.warn("ai_novel kickoff tool name repaired", {
      taskType: "kickoff_turn",
      attempt: input.attempt,
      toolName: input.toolName,
      repairedToolName: lowerKind,
      toolCallId: input.toolCallId,
      reasons: ["tool_name_case_mismatch"],
      originalInput: input.originalInput,
    });
    return { toolKind: lowerKind, normalizedToolName: lowerKind };
  }

  private buildKickoffInvalidToolAssistantMessage(
    attempt: KickoffTurnAttempt,
    failedToolCall: LLMToolCall,
    diagnostics: KickoffToolNormalizationDiagnostics,
  ): LLMMessage {
    return {
      role: "assistant",
      content: attempt.assistantText,
      toolCalls: [
        {
          id: failedToolCall.id,
          name: kickoffInvalidToolName,
          input: {
            tool: failedToolCall.name,
            error: this.formatKickoffInvalidToolError(diagnostics),
          },
        },
      ],
    };
  }

  private buildKickoffInvalidToolResultMessage(
    toolCallId: string,
    diagnostics: KickoffToolNormalizationDiagnostics,
  ): LLMMessage {
    return {
      role: "tool",
      toolCallId,
      content:
        `The arguments provided to tool "${diagnostics.toolName}" are invalid: ` +
        `${this.formatKickoffInvalidToolError(diagnostics)} ` +
        "Please call the correct kickoff tool again with arguments that satisfy the schema.",
    };
  }

  private formatKickoffInvalidToolError(
    diagnostics: KickoffToolNormalizationDiagnostics,
  ): string {
    const reasons = diagnostics.reasons.length > 0
      ? diagnostics.reasons.join(", ")
      : "payload did not satisfy the tool schema";
    return `${reasons}. Original input: ${JSON.stringify(diagnostics.originalInput)}`;
  }

  private mergeKickoffUsage(
    first: AiNovelUsagePayload | undefined,
    second: AiNovelUsagePayload | undefined,
  ): AiNovelUsagePayload | undefined {
    if (!first) {
      return second;
    }
    if (!second) {
      return first;
    }
    return {
      promptTokens: first.promptTokens + second.promptTokens,
      completionTokens: first.completionTokens + second.completionTokens,
      totalTokens: first.totalTokens + second.totalTokens,
      ...(second.contextWindowTokens ?? first.contextWindowTokens
        ? {
            contextWindowTokens:
              second.contextWindowTokens ?? first.contextWindowTokens,
          }
        : {}),
      ...(second.contextUsedRatio ?? first.contextUsedRatio
        ? {
            contextUsedRatio:
              second.contextUsedRatio ?? first.contextUsedRatio,
          }
        : {}),
    };
  }

  private buildKickoffMessages(
    messages: LLMMessage[],
    meta: KickoffMeta,
  ): LLMMessage[] {
    return [
      {
        role: "system",
        content: `${KICKOFF_SYSTEM_PROMPT}\n\n${this.renderKickoffSummary(meta)}`,
      },
      ...messages,
    ];
  }

  private renderKickoffSummary(meta: KickoffMeta): string {
    return [
      "Current kickoff summary:",
      `- titleCandidate: ${meta.titleCandidate}`,
      `- readiness: ${meta.readiness.toFixed(2)}`,
      "",
      "Current canonical premise / contract:",
      `- storyPromise: ${meta.storyPromise}`,
      `- storyAnchors: ${JSON.stringify(meta.storyAnchors)}`,
      `- focalization: ${meta.focalization}`,
      `- startState: ${meta.startState}`,
      `- trigger: ${meta.trigger}`,
      `- drive: ${meta.drive.mode} ${meta.drive.object}`.trim(),
      `- pressureSources: ${meta.pressureSources.join(" / ")}`,
      `- stakes.external: ${meta.stakes.external}`,
      `- stakes.relational: ${meta.stakes.relational}`,
      `- stakes.internal: ${meta.stakes.internal}`,
      `- worldConstraints: ${meta.worldConstraints.join(" / ")}`,
      `- changeHorizon: ${meta.changeHorizon}`,
      `- premiseScale.length: ${this.renderScaleChoice(meta.premiseScale.length)}`,
      `- premiseScale.chapterLength: ${this.renderChapterLength(meta.premiseScale.chapterLength)}`,
      `- premiseScale.pov: ${this.renderScaleChoice(meta.premiseScale.pov)}`,
      `- premiseScale.threadDensity: ${this.renderScaleChoice(meta.premiseScale.threadDensity)}`,
      `- premiseScale.pace: ${this.renderScaleChoice(meta.premiseScale.pace)}`,
      `- language: ${meta.language}`,
      `- toneRegister: ${meta.toneRegister}`,
    ].join("\n");
  }

  private renderScaleChoice(choice: KickoffScaleChoice): string {
    return [choice.preset, choice.note].filter(Boolean).join(" / ");
  }

  private renderChapterLength(chapterLength: KickoffChapterLength): string {
    const range =
      chapterLength.minChars !== undefined && chapterLength.maxChars !== undefined
        ? `${chapterLength.minChars}-${chapterLength.maxChars}`
        : chapterLength.minChars !== undefined
          ? `>=${chapterLength.minChars}`
          : chapterLength.maxChars !== undefined
            ? `<=${chapterLength.maxChars}`
            : "";
    return [chapterLength.preset, range, chapterLength.note]
      .filter(Boolean)
      .join(" / ");
  }

  private normalizeKickoffMetaContext(value: unknown): KickoffMeta {
    const meta =
      isRecord(value) && isRecord(value.meta)
        ? (value.meta as Record<string, unknown>)
        : isRecord(value)
          ? (value as Record<string, unknown>)
          : {};
    return {
      titleCandidate: this.readOptionalString(meta.titleCandidate) ?? "",
      readiness: this.normalizeReadiness(meta.readiness),
      storyPromise: this.readOptionalString(meta.storyPromise) ?? "",
      storyAnchors: this.normalizeStoryAnchors(meta.storyAnchors, 12),
      focalization: this.readOptionalString(meta.focalization) ?? "",
      startState: this.readOptionalString(meta.startState) ?? "",
      trigger: this.readOptionalString(meta.trigger) ?? "",
      drive: this.normalizeKickoffDrive(meta.drive),
      pressureSources: this.normalizeKickoffQuestionStrings(
        meta.pressureSources,
        12,
      ),
      stakes: this.normalizeKickoffStakes(meta.stakes),
      worldConstraints: this.normalizeKickoffQuestionStrings(
        meta.worldConstraints,
        12,
      ),
      changeHorizon: this.readOptionalString(meta.changeHorizon) ?? "",
      premiseScale: this.normalizeKickoffScale(meta.premiseScale),
      language: this.readOptionalString(meta.language) ?? "",
      toneRegister: this.readOptionalString(meta.toneRegister) ?? "",
      extras: isRecord(meta.extras) ? meta.extras : {},
    };
  }

  private normalizeKickoffDrive(value: unknown): KickoffDrive {
    const record = isRecord(value) ? value : {};
    return {
      mode: this.readOptionalString(record.mode) ?? "",
      object: this.readOptionalString(record.object) ?? "",
    };
  }

  private normalizeKickoffStakes(value: unknown): KickoffStakes {
    const record = isRecord(value) ? value : {};
    return {
      external: this.readOptionalString(record.external) ?? "",
      relational: this.readOptionalString(record.relational) ?? "",
      internal: this.readOptionalString(record.internal) ?? "",
    };
  }

  private normalizeKickoffScale(value: unknown): KickoffScale {
    const record = isRecord(value) ? value : {};
    return {
      length: this.normalizeScaleChoiceContext(record.length),
      chapterLength: this.normalizeChapterLengthContext(record.chapterLength),
      pov: this.normalizeScaleChoiceContext(record.pov),
      threadDensity: this.normalizeScaleChoiceContext(record.threadDensity),
      pace: this.normalizeScaleChoiceContext(record.pace),
    };
  }

  private normalizeScaleChoiceContext(value: unknown): KickoffScaleChoice {
    const record = isRecord(value) ? value : {};
    return {
      preset: this.readOptionalString(record.preset) ?? "",
      note: this.readOptionalString(record.note) ?? "",
    };
  }

  private normalizeChapterLengthContext(
    value: unknown,
  ): KickoffChapterLength {
    const record = isRecord(value) ? value : {};
    const chapterLength: KickoffChapterLength = {
      preset: this.readOptionalString(record.preset) ?? "",
      note: this.readOptionalString(record.note) ?? "",
    };
    const minChars = this.readOptionalPositiveInteger(record.minChars);
    const maxChars = this.readOptionalPositiveInteger(record.maxChars);
    if (minChars !== undefined) {
      chapterLength.minChars = minChars;
    }
    if (maxChars !== undefined) {
      chapterLength.maxChars = maxChars;
    }
    return chapterLength;
  }

  private normalizeStoryAnchors(value: unknown, maxItems: number): StoryAnchor[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const anchors: StoryAnchor[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (!isRecord(item)) {
        continue;
      }
      const label = this.readOptionalString(item.label);
      const role = this.readOptionalString(item.role);
      if (!label || !role || seen.has(label)) {
        continue;
      }
      anchors.push({
        label,
        role,
        rules: this.normalizeKickoffQuestionStrings(item.rules, 5),
      });
      seen.add(label);
      if (anchors.length >= maxItems) {
        break;
      }
    }
    return anchors;
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private readOptionalPositiveInteger(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : undefined;
  }

  private normalizeReadiness(value: unknown): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, value));
  }

  private normalizeKickoffToolCall(
    toolCall: LLMToolCall,
    toolKind: KickoffToolKind,
  ): KickoffToolNormalizationResult {
    const normalizer = this.kickoffToolNormalizers[toolKind];
    return normalizer(toolCall);
  }

  private readonly kickoffToolNormalizers: Record<
    KickoffToolKind,
    (toolCall: LLMToolCall) => KickoffToolNormalizationResult
  > = {
    [kickoffToolWireNames.askQuestion]: (toolCall) =>
      this.normalizeKickoffAskQuestionToolCall(toolCall),
    [kickoffToolWireNames.updateMeta]: (toolCall) =>
      this.normalizeKickoffUpdateMetaToolCall(toolCall),
    [kickoffToolWireNames.readMeta]: (toolCall) =>
      this.emptyPayloadKickoffToolCall(toolCall),
    [kickoffToolWireNames.ready]: (toolCall) =>
      this.normalizeKickoffReadyToolCall(toolCall),
  };

  private emptyPayloadKickoffToolCall(
    toolCall: LLMToolCall,
  ): KickoffToolNormalizationResult {
    return {
      toolCall: {
        id: toolCall.id,
        name: toolCall.name,
        input: {},
      },
    };
  }

  private normalizeKickoffReadyToolCall(
    toolCall: LLMToolCall,
  ): KickoffToolNormalizationResult {
    const reasons = new Set<string>();
    const summary = this.readOptionalString(toolCall.input.summary);
    if (typeof toolCall.input.summary !== "string") {
      reasons.add("summary_missing_or_not_string");
    } else if (toolCall.input.summary.trim() !== toolCall.input.summary) {
      reasons.add("summary_trimmed");
    }
    if (!summary) {
      return {
        diagnostics: this.logKickoffToolNormalization({
          accepted: false,
          toolCall,
          reasons: [...reasons],
        }),
      };
    }
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input: { summary },
    };
    return {
      toolCall: normalizedToolCall,
      diagnostics: this.logKickoffToolNormalization({
        accepted: true,
        toolCall,
        normalizedToolCall,
        reasons: [...reasons],
      }),
    };
  }

  private normalizeKickoffAskQuestionToolCall(
    toolCall: LLMToolCall,
  ): KickoffToolNormalizationResult {
    const reasons = new Set<string>();
    const question = this.readOptionalString(toolCall.input.question);
    if (typeof toolCall.input.question !== "string") {
      reasons.add("question_missing_or_not_string");
    } else if (toolCall.input.question.trim() !== toolCall.input.question) {
      reasons.add("question_trimmed");
    }
    const optionNormalization = this.normalizeKickoffQuestionOptions(
      toolCall.input.options,
      kickoffAskQuestionRuntimeOptionLimit,
    );
    for (const reason of optionNormalization.reasons) {
      reasons.add(reason);
    }
    const options = optionNormalization.options;
    if (!question || options.length === 0) {
      if (options.length === 0) {
        reasons.add("options_below_minimum_after_normalization");
      }
      return {
        diagnostics: this.logKickoffToolNormalization({
          accepted: false,
          toolCall,
          reasons: [...reasons],
        }),
      };
    }

    const input: Record<string, unknown> = {
      question,
      options,
    };
    const optionSubtitlesFromOptions = optionNormalization.optionSubtitles;
    const legacyOptionSubtitles = this.normalizeKickoffQuestionStrings(
      toolCall.input.optionSubtitles,
      options.length,
    );
    const optionSubtitles = optionSubtitlesFromOptions.length === options.length
      ? optionSubtitlesFromOptions
      : legacyOptionSubtitles;
    if (toolCall.input.optionSubtitles !== undefined) {
      if (!Array.isArray(toolCall.input.optionSubtitles)) {
        reasons.add("option_subtitles_not_array");
      } else if (legacyOptionSubtitles.length !== options.length) {
        reasons.add("option_subtitles_dropped_for_alignment");
      } else if (
        toolCall.input.optionSubtitles.length !== legacyOptionSubtitles.length
      ) {
        reasons.add("option_subtitles_filtered_or_trimmed");
      }
    }
    if (optionSubtitles.length === options.length) {
      input.optionSubtitles = optionSubtitles;
    }
    if (toolCall.input.allowCustom !== false) {
      input.allowCustom = true;
    } else {
      input.allowCustom = false;
    }
    if (
      toolCall.input.allowCustom !== undefined &&
      typeof toolCall.input.allowCustom !== "boolean"
    ) {
      reasons.add("allow_custom_ignored");
    }
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input,
    };
    return {
      toolCall: normalizedToolCall,
      diagnostics: this.logKickoffToolNormalization({
        accepted: true,
        toolCall,
        normalizedToolCall,
        reasons: [...reasons],
      }),
    };
  }

  private normalizeKickoffUpdateMetaToolCall(
    toolCall: LLMToolCall,
  ): KickoffToolNormalizationResult {
    const reasons = new Set<string>();
    const input: Record<string, unknown> = {};
    const titleCandidate = this.readOptionalString(
      toolCall.input.titleCandidate,
    );
    const storyPromise = this.readOptionalString(toolCall.input.storyPromise);
    const storyAnchors = this.normalizeStoryAnchors(
      toolCall.input.storyAnchors,
      12,
    );
    const changeHorizon = this.readOptionalString(
      toolCall.input.changeHorizon,
    );
    const premiseScale = this.normalizeKickoffScaleToolInput(
      toolCall.input.premiseScale,
      reasons,
    );
    const knownKeys = new Set([
      "titleCandidate",
      "readiness",
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
      "premiseScale",
      "language",
      "toneRegister",
      "extras",
    ]);
    for (const key of Object.keys(toolCall.input)) {
      if (!knownKeys.has(key)) {
        reasons.add("unknown_update_meta_fields_dropped");
        break;
      }
    }
    if (titleCandidate) {
      input.titleCandidate = titleCandidate;
      if (toolCall.input.titleCandidate !== titleCandidate) {
        reasons.add("title_candidate_trimmed");
      }
    } else if (toolCall.input.titleCandidate !== undefined) {
      reasons.add("title_candidate_dropped");
    }
    if (typeof toolCall.input.readiness === "number") {
      const normalizedReadiness = this.normalizeReadiness(
        toolCall.input.readiness,
      );
      input.readiness = normalizedReadiness;
      if (normalizedReadiness !== toolCall.input.readiness) {
        reasons.add("readiness_clamped");
      }
    } else if (toolCall.input.readiness !== undefined) {
      reasons.add("readiness_dropped");
    }
    if (storyPromise) {
      input.storyPromise = storyPromise;
      if (toolCall.input.storyPromise !== storyPromise) {
        reasons.add("storyPromise_trimmed");
      }
    } else if (toolCall.input.storyPromise !== undefined) {
      reasons.add("storyPromise_dropped");
    }
    this.copyOptionalStringField(
      toolCall.input,
      input,
      reasons,
      "focalization",
    );
    this.copyOptionalStringField(toolCall.input, input, reasons, "startState");
    this.copyOptionalStringField(toolCall.input, input, reasons, "trigger");
    if (changeHorizon) {
      input.changeHorizon = changeHorizon;
      if (toolCall.input.changeHorizon !== changeHorizon) {
        reasons.add("changeHorizon_trimmed");
      }
    } else if (toolCall.input.changeHorizon !== undefined) {
      reasons.add("changeHorizon_dropped");
    }
    this.copyOptionalStringField(toolCall.input, input, reasons, "language");
    this.copyOptionalStringField(
      toolCall.input,
      input,
      reasons,
      "toneRegister",
    );
    if (storyAnchors.length > 0) {
      input.storyAnchors = storyAnchors;
      const rawValue = toolCall.input.storyAnchors;
      if (!Array.isArray(rawValue) || storyAnchors.length !== rawValue.length) {
        reasons.add("storyAnchors_normalized");
      }
    } else if (toolCall.input.storyAnchors !== undefined) {
      reasons.add("storyAnchors_dropped");
    }
    this.copyOptionalStringArrayField(
      toolCall.input,
      input,
      reasons,
      "pressureSources",
    );
    this.copyOptionalStringArrayField(
      toolCall.input,
      input,
      reasons,
      "worldConstraints",
    );
    this.copyOptionalObjectField(toolCall.input, input, reasons, "drive");
    this.copyOptionalObjectField(toolCall.input, input, reasons, "stakes");
    if (premiseScale !== undefined) {
      input.premiseScale = premiseScale;
    } else if (toolCall.input.premiseScale !== undefined) {
      reasons.add("premiseScale_dropped");
    }
    this.copyOptionalObjectField(toolCall.input, input, reasons, "extras");
    if (Object.keys(input).length === 0) {
      reasons.add("update_meta_empty_after_normalization");
      return {
        diagnostics: this.logKickoffToolNormalization({
          accepted: false,
          toolCall,
          reasons: [...reasons],
        }),
      };
    }
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input,
    };
    return {
      toolCall: normalizedToolCall,
      diagnostics: this.logKickoffToolNormalization({
        accepted: true,
        toolCall,
        normalizedToolCall,
        reasons: [...reasons],
      }),
    };
  }

  private normalizeKickoffScaleToolInput(
    value: unknown,
    reasons: Set<string>,
  ): KickoffScale | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!isRecord(value)) {
      reasons.add("premiseScale_not_object");
      return undefined;
    }
    const length = this.normalizeScaleChoiceToolInput(
      value.length,
      "premiseScale.length",
      kickoffScaleLengthPresets,
      reasons,
    );
    const chapterLength = this.normalizeChapterLengthToolInput(
      value.chapterLength,
      reasons,
    );
    const pov = this.normalizeScaleChoiceToolInput(
      value.pov,
      "premiseScale.pov",
      kickoffPovPresets,
      reasons,
    );
    const threadDensity = this.normalizeScaleChoiceToolInput(
      value.threadDensity,
      "premiseScale.threadDensity",
      kickoffThreadDensityPresets,
      reasons,
    );
    const pace = this.normalizeScaleChoiceToolInput(
      value.pace,
      "premiseScale.pace",
      kickoffPacePresets,
      reasons,
    );
    if (!length || !chapterLength || !pov || !threadDensity || !pace) {
      reasons.add("premiseScale_incomplete_or_invalid");
      return undefined;
    }
    return { length, chapterLength, pov, threadDensity, pace };
  }

  private normalizeScaleChoiceToolInput(
    value: unknown,
    field: string,
    allowedPresets: Set<string>,
    reasons: Set<string>,
  ): KickoffScaleChoice | undefined {
    if (!isRecord(value)) {
      reasons.add(`${field}_not_object`);
      return undefined;
    }
    const preset = this.readOptionalString(value.preset);
    const note = this.readOptionalString(value.note) ?? "";
    if (!preset) {
      reasons.add(`${field}_preset_missing`);
      return undefined;
    }
    if (!allowedPresets.has(preset)) {
      reasons.add(`${field}_preset_unknown`);
      return undefined;
    }
    if (preset === kickoffScalePresetCustom && !note) {
      reasons.add(`${field}_custom_note_missing`);
      return undefined;
    }
    return { preset, note };
  }

  private normalizeChapterLengthToolInput(
    value: unknown,
    reasons: Set<string>,
  ): KickoffChapterLength | undefined {
    if (!isRecord(value)) {
      reasons.add("premiseScale.chapterLength_not_object");
      return undefined;
    }
    const preset = this.readOptionalString(value.preset);
    const note = this.readOptionalString(value.note) ?? "";
    if (!preset) {
      reasons.add("premiseScale.chapterLength_preset_missing");
      return undefined;
    }
    if (!kickoffChapterLengthPresets.has(preset)) {
      reasons.add("premiseScale.chapterLength_preset_unknown");
      return undefined;
    }
    if (preset === kickoffScalePresetCustom && !note) {
      reasons.add("premiseScale.chapterLength_custom_note_missing");
      return undefined;
    }
    const chapterLength: KickoffChapterLength = { preset, note };
    const minChars = this.readOptionalPositiveInteger(value.minChars);
    const maxChars = this.readOptionalPositiveInteger(value.maxChars);
    if (minChars !== undefined) {
      chapterLength.minChars = minChars;
    } else if (value.minChars !== undefined) {
      reasons.add("premiseScale.chapterLength_minChars_dropped");
    }
    if (maxChars !== undefined) {
      chapterLength.maxChars = maxChars;
    } else if (value.maxChars !== undefined) {
      reasons.add("premiseScale.chapterLength_maxChars_dropped");
    }
    if (
      chapterLength.minChars !== undefined &&
      chapterLength.maxChars !== undefined &&
      chapterLength.minChars > chapterLength.maxChars
    ) {
      const normalizedValue = chapterLength.minChars;
      chapterLength.minChars = normalizedValue;
      chapterLength.maxChars = normalizedValue;
      reasons.add("premiseScale.chapterLength_range_inverted_collapsed");
    }
    return chapterLength;
  }

  private copyOptionalStringField(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    reasons: Set<string>,
    key: string,
  ): void {
    const value = this.readOptionalString(source[key]);
    if (value) {
      target[key] = value;
      if (source[key] !== value) {
        reasons.add(`${key}_trimmed`);
      }
    } else if (source[key] !== undefined) {
      reasons.add(`${key}_dropped`);
    }
  }

  private copyOptionalStringArrayField(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    reasons: Set<string>,
    key: string,
  ): void {
    const value = this.normalizeKickoffQuestionStrings(source[key], 12);
    if (value.length > 0) {
      target[key] = value;
      const rawValue = source[key];
      if (!Array.isArray(rawValue) || value.length !== rawValue.length) {
        reasons.add(`${key}_normalized`);
      }
    } else if (source[key] !== undefined) {
      reasons.add(`${key}_dropped`);
    }
  }

  private copyOptionalObjectField(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    reasons: Set<string>,
    key: string,
  ): void {
    if (isRecord(source[key])) {
      target[key] = source[key];
    } else if (source[key] !== undefined) {
      reasons.add(`${key}_dropped`);
    }
  }

  private normalizeKickoffQuestionStrings(
    value: unknown,
    maxItems: number,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }
      const next = item.trim();
      if (!next || seen.has(next)) {
        continue;
      }
      normalized.push(next);
      seen.add(next);
      if (normalized.length >= maxItems) {
        break;
      }
    }
    return normalized;
  }

  private normalizeKickoffQuestionOptions(
    value: unknown,
    maxItems: number,
  ): KickoffQuestionOptionNormalization {
    const reasons = new Set<string>();
    const source = this.readKickoffQuestionOptionArray(value, reasons);
    if (!source) {
      return { options: [], optionSubtitles: [], reasons: [...reasons] };
    }
    const options: string[] = [];
    const optionSubtitles: string[] = [];
    const seen = new Set<string>();
    let filteredOrDeduplicated = false;
    let sawObjectOption = false;
    let sawStringOption = false;
    let sawMissingSubtitle = false;

    for (const item of source) {
      const normalized = this.normalizeKickoffQuestionOptionItem(item);
      if (!normalized) {
        filteredOrDeduplicated = true;
        continue;
      }
      if (normalized.kind === "object") {
        sawObjectOption = true;
      } else {
        sawStringOption = true;
      }
      if (!normalized.subtitle) {
        sawMissingSubtitle = true;
      }
      if (seen.has(normalized.label)) {
        filteredOrDeduplicated = true;
        continue;
      }
      options.push(normalized.label);
      optionSubtitles.push(normalized.subtitle);
      seen.add(normalized.label);
      if (options.length >= maxItems) {
        break;
      }
    }

    if (source.length > maxItems) {
      reasons.add("options_truncated_to_runtime_limit");
    }
    if (filteredOrDeduplicated || source.length !== options.length) {
      reasons.add("options_filtered_or_deduplicated");
    }
    if (sawObjectOption && sawStringOption) {
      reasons.add("options_mixed_object_and_string_items");
    } else if (sawStringOption) {
      reasons.add("options_legacy_string_items_normalized");
    }
    if (sawObjectOption && sawMissingSubtitle) {
      reasons.add("option_subtitles_missing_or_empty");
    }

    return {
      options,
      optionSubtitles: optionSubtitles.every((item) => item.length > 0)
        ? optionSubtitles
        : [],
      reasons: [...reasons],
    };
  }

  private readKickoffQuestionOptionArray(
    value: unknown,
    reasons: Set<string>,
  ): unknown[] | undefined {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value !== "string") {
      reasons.add("options_missing_or_not_array");
      return undefined;
    }
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        reasons.add("options_json_string_not_array");
        return undefined;
      }
      reasons.add("options_json_string_parsed");
      return parsed;
    } catch {
      reasons.add("options_missing_or_not_array");
      reasons.add("options_string_json_parse_failed");
      return undefined;
    }
  }

  private normalizeKickoffQuestionOptionItem(
    value: unknown,
  ): KickoffQuestionOptionItem | undefined {
    if (typeof value === "string") {
      const label = this.readOptionalString(value);
      return label ? { label, subtitle: "", kind: "string" } : undefined;
    }
    if (!isRecord(value)) {
      return undefined;
    }
    const label = this.readOptionalString(value.label);
    if (!label) {
      return undefined;
    }
    return {
      label,
      subtitle: this.readOptionalString(value.subtitle) ?? "",
      kind: "object",
    };
  }

  private logKickoffToolNormalization(input: {
    accepted: boolean;
    toolCall: LLMToolCall;
    reasons: string[];
    normalizedToolCall?: LLMToolCall;
  }): KickoffToolNormalizationDiagnostics {
    const toolDefinition = this.kickoffToolDefinitionDebug(
      input.toolCall.name,
    );
    const diagnostics: KickoffToolNormalizationDiagnostics = {
      toolName: input.toolCall.name,
      toolCallId: input.toolCall.id,
      reasons: input.reasons,
      originalInput: input.toolCall.input,
      ...(input.normalizedToolCall
        ? { normalizedInput: input.normalizedToolCall.input }
        : {}),
      ...(toolDefinition ? { toolDefinition } : {}),
    };
    if (this.logger && input.reasons.length > 0) {
      this.logger.warn(
        input.accepted
          ? "ai_novel kickoff tool payload normalized"
          : "ai_novel kickoff tool payload rejected",
        {
          taskType: "kickoff_turn",
          accepted: input.accepted,
          ...diagnostics,
        },
      );
    }
    return diagnostics;
  }

  private kickoffToolDefinitionDebug(
    toolName: string,
  ): KickoffToolNormalizationDiagnostics["toolDefinition"] | undefined {
    const definition = kickoffToolDefinitions.find(
      (tool) => tool.name === toolName,
    );
    if (!definition) {
      return undefined;
    }
    return {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    };
  }

  async createEmbeddings(
    body: Record<string, unknown>,
  ): Promise<AiNovelEmbeddingsResponse> {
    if (body.model !== undefined) {
      badRequest(
        "REQ_INVALID_BODY",
        "model is not allowed. Use taskType to select the server-side scene.",
      );
    }

    const taskType = this.requireTaskType(body);
    const scene = resolveAiNovelEmbeddingScene(taskType);
    const modelKey = await this.appAiRoutingConfigService.resolveModelKey(
      AI_NOVEL_APP_ID,
      "embedding",
      scene.taskType,
      "free",
    );
    const input = this.normalizeEmbeddingInput(body.input);

    try {
      const result = await this.embeddingManager.embed({
        modelKey,
        input,
      });

      return {
        taskType: scene.taskType,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
        vectors: result.vectors,
        ...(result.providerRequestId
          ? { providerRequestId: result.providerRequestId }
          : {}),
      };
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  private requireTaskType(body: Record<string, unknown>): string {
    const taskType = body.taskType;
    if (typeof taskType !== "string" || !taskType.trim()) {
      badRequest("REQ_INVALID_BODY", "taskType must be a non-empty string.");
    }
    return taskType.trim();
  }

  private normalizeMessages(value: unknown): LLMMessage[] {
    if (!Array.isArray(value) || value.length === 0) {
      badRequest(
        "REQ_INVALID_BODY",
        "messages must contain at least one item.",
      );
    }

    return value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("REQ_INVALID_BODY", "Each message must be a JSON object.");
      }

      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if (
        role !== "system" &&
        role !== "user" &&
        role !== "assistant" &&
        role !== "tool"
      ) {
        badRequest(
          "REQ_INVALID_BODY",
          `Unsupported LLM role: ${String(role)}.`,
        );
      }

      if (typeof content !== "string") {
        badRequest(
          "REQ_INVALID_BODY",
          "Each message content must be a string.",
        );
      }

      const toolCallId = this.readOptionalString(record.toolCallId);
      const toolCalls = this.normalizeToolCalls(record.toolCalls);
      if (role === "tool") {
        if (!toolCallId) {
          badRequest("REQ_INVALID_BODY", "tool messages require toolCallId.");
        }
        if (!content.trim()) {
          badRequest(
            "REQ_INVALID_BODY",
            "tool message content must be a non-empty string.",
          );
        }
      } else if (!content.trim() && toolCalls.length === 0) {
        badRequest(
          "REQ_INVALID_BODY",
          "assistant/system/user messages need content or toolCalls.",
        );
      }

      return {
        role,
        content,
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    });
  }

  private normalizeToolCalls(value: unknown): LLMToolCall[] {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      badRequest(
        "REQ_INVALID_BODY",
        "toolCalls must be an array when provided.",
      );
    }
    return value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest(
          "REQ_INVALID_BODY",
          `toolCalls[${index}] must be a JSON object.`,
        );
      }
      const record = item as Record<string, unknown>;
      const id = this.readOptionalString(record.id);
      const name = this.readOptionalString(record.name);
      if (!id || !name) {
        badRequest(
          "REQ_INVALID_BODY",
          `toolCalls[${index}] requires id and name.`,
        );
      }
      const input = isRecord(record.input)
        ? (record.input as Record<string, unknown>)
        : {};
      return {
        id,
        name,
        input,
      };
    });
  }

  private normalizeEmbeddingInput(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      badRequest(
        "AI_EMBEDDING_INPUT_INVALID",
        "input must be a non-empty string array.",
      );
    }

    return value.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        badRequest(
          "AI_EMBEDDING_INPUT_INVALID",
          "input must contain non-empty strings only.",
        );
      }
      return item.trim();
    });
  }

  private optionalNumber(
    value: unknown,
    fieldName: string,
  ): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "number" || Number.isNaN(value)) {
      badRequest(
        "REQ_INVALID_BODY",
        `${fieldName} must be a number when provided.`,
      );
    }

    return value;
  }

  private optionalPositiveInteger(
    value: unknown,
    fieldName: string,
  ): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (
      typeof value !== "number" ||
      Number.isNaN(value) ||
      value <= 0 ||
      !Number.isInteger(value)
    ) {
      badRequest(
        "REQ_INVALID_BODY",
        `${fieldName} must be a positive integer when provided.`,
      );
    }

    return value;
  }

  private mapUpstreamError(error: unknown): unknown {
    if (!(error instanceof ApplicationError)) {
      return error;
    }

    if (error.code === "LLM_PROVIDER_REQUEST_FAILED") {
      if (
        error.statusCode === 504 ||
        getDetailString(error.details, "reason") === "timeout"
      ) {
        return new ApplicationError(
          504,
          "AI_UPSTREAM_TIMEOUT",
          "Upstream model service timed out.",
          error.details,
        );
      }

      return new ApplicationError(
        502,
        "AI_UPSTREAM_BAD_GATEWAY",
        error.message,
        error.details,
      );
    }

    if (
      error.code === "LLM_PROVIDER_RESPONSE_INVALID" ||
      error.code === "LLM_ROUTE_NOT_AVAILABLE" ||
      error.code === "LLM_SERVICE_NOT_CONFIGURED" ||
      error.code === "LLM_MODEL_NOT_FOUND"
    ) {
      return new ApplicationError(
        502,
        "AI_UPSTREAM_BAD_GATEWAY",
        error.message,
        error.details,
      );
    }

    return error;
  }
}

function getDetailString(details: unknown, key: string): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }

  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
