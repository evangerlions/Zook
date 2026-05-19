import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type {
  LLMMessage,
  LLMManager,
  LLMCompletionResult,
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
  name?: string;
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
                  "Concise anchor label in the user's writing language, e.g. protagonist, protagonist group, central relationship, core mystery, or main stage.",
              },
              name: {
                type: "string",
                description:
                  "Optional concrete character name when this anchor represents the protagonist or another named character. For protagonist anchors, this must be a real name, alias, or codename, never a pronoun such as 我/I or a generic label such as 主角.",
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
      "Declare the kickoff sufficient to start writing and provide the user-facing ready card summary plus the first MainLine plan.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "mainLine"],
      properties: {
        summary: {
          type: "string",
          description:
            "A concise natural-language description of what this book is like. This is shown on the ready card; it is not a contract field.",
        },
        mainLine: {
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
            revisionId: {
              type: "string",
              description:
                "Use kickoff for the first ready plan. Later runtime may replace it with another revision.",
            },
            title: {
              type: "string",
              description:
                "User-facing title for the opening arc or first stage.",
            },
            summary: {
              type: "string",
              description:
                "User-facing 1-2 sentence summary of the first 6-10 chapters.",
            },
            arcPromise: {
              type: "string",
              description:
                "The user-facing reading promise for this opening arc or current stage.",
            },
            arcRules: {
              type: "array",
              items: { type: "string" },
              description:
                "Concrete current-stage rules derived from the Contract and user anti-trope constraints.",
            },
            startChapterIndex: { type: "integer", minimum: 1 },
            endChapterIndex: { type: "integer", minimum: 1 },
            beats: {
              type: "array",
              minItems: 6,
              maxItems: 10,
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
                  goal: {
                    type: "string",
                    description:
                      "Concrete chapter-level movement, not a slogan.",
                  },
                  mustCover: {
                    type: "array",
                    items: { type: "string" },
                  },
                  forbidden: {
                    type: "array",
                    items: { type: "string" },
                  },
                  change: {
                    type: "string",
                    description:
                      "What irreversible story state changes in this chapter.",
                  },
                  endBoundary: {
                    type: "string",
                    description:
                      "Where this chapter must stop. It must tell the draft agent what later beat not to narrate yet.",
                  },
                  endingOpenQuestion: {
                    type: "string",
                    description:
                      "Concrete unresolved pressure or question, may be empty if not natural.",
                  },
                },
              },
            },
          },
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
  "7. Call ready only when titleCandidate, storyPromise, storyAnchors, protagonist name, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, and toneRegister are sufficiently clear.",
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
  "- When a storyAnchor represents the protagonist, include `name`: a concrete character name, alias, or codename suitable for the user's genre and language.",
  "- Do not use pronouns or generic labels as protagonist `name`: never use 我, I, 主角, 男主, 女主, 他, 她, 少年, 青年, protagonist, hero, heroine, or main character unless the user explicitly states that exact string is the character's literal name.",
  "- For first-person novels, keep `name` as the character's real name/alias and describe first-person narration in focalization or the protagonist anchor rules; do not set name to 我/I.",
  "- If the user did not provide a protagonist name, generate a fitting one before ready instead of asking a separate naming question unless the naming choice is genuinely user-blocking.",
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
  "- Do not call ready until the protagonist anchor has a concrete non-placeholder `name`.",
  "- When calling ready, include summary: one polished natural-language paragraph describing what this book is like for the ready card.",
  "- When calling ready, include mainLine: a user-facing rolling plan for the first 6-10 chapters. This is the opening arc the user will confirm on the ready card before drafting starts.",
  "- mainLine must describe what this stage roughly does, like a human writer's first-volume direction. It must be concrete enough to prevent per-chapter improvisation, but not so rigid that every chapter needs a forced hook.",
  "- mainLine.arcPromise must state the opening/current arc's reading promise. mainLine.arcRules must turn user anti-trope or genre constraints into concrete stage rules.",
  "- mainLine.beats must be written in the user's writing language. Each beat must include goal, mustCover array, forbidden array, change, and endBoundary.",
  "- mainLine.beats[].endingOpenQuestion must exist but may be an empty string when a hook would feel forced.",
  "- mainLine.beats[].endBoundary must say where the chapter stops and which later movement should not be narrated yet.",
  "- For transition or threshold beats, do not make endBoundary so narrow that a standard chapter can only write the first step. Allow relevant same-scene preparation, emotional consequence, immediate pressure, and concrete threshold detail, while forbidding later-location movement, next-stage planning, or the next major crisis unless the beat explicitly asks for it.",
  "- mustCover and forbidden arrays may be empty for quiet transition chapters, but the fields must still be present.",
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
  localDebugLlmRequest?: AiNovelLocalDebugLlmRequestPayload;
}

interface AiNovelUsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
}

interface AiNovelLocalDebugOptions {
  exposeLocalDebug?: boolean;
}

interface AiNovelLocalDebugLlmRequestPayload {
  taskType: string;
  modelKey: string;
  temperature: number;
  maxTokens: number;
  profile?: AiNovelPromptProfile;
  requestBody: {
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    stream: boolean;
    providerOptions?: Record<string, unknown>;
  };
}

export type AiNovelChatStreamChunk =
  | {
      type: "text_delta";
      text: string;
    }
  | {
      type: "local_debug_llm_request";
      payload: AiNovelLocalDebugLlmRequestPayload;
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
  private static readonly STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS = 20_000;

  constructor(
    private readonly llmManager: LLMManager,
    private readonly embeddingManager: EmbeddingManager,
    private readonly appAiRoutingConfigService: AppAiRoutingConfigService,
    private readonly logger?: StructuredLogger,
  ) {}

  async createChatCompletion(
    body: Record<string, unknown>,
    options: AiNovelLocalDebugOptions = {},
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
    const providerOptions =
      scene.completeViaStream || promptAssembly.tools.length > 0
        ? {
            ...(scene.completeViaStream ? { enable_thinking: false } : {}),
            ...(promptAssembly.tools.length > 0
              ? {
                  tools: toOpenAiToolDefinitions(promptAssembly.tools),
                  tool_choice: "auto",
                }
              : {}),
          }
        : undefined;
    try {
      const llmRequest = {
        modelKey,
        messages: promptAssembly.messages,
        temperature,
        maxTokens,
        ...(providerOptions ? { providerOptions } : {}),
      };
      const result: LLMCompletionResult = scene.completeViaStream
        ? await this.llmManager.completeViaStream(llmRequest, {
            firstContentTimeoutMs:
              AiNovelLlmService.STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS,
          })
        : await this.llmManager.complete(llmRequest);

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
        ...(options.exposeLocalDebug === true
          ? {
              localDebugLlmRequest: this.buildLocalDebugLlmRequestPayload({
                taskType: scene.taskType,
                modelKey,
                messages: promptAssembly.messages,
                temperature,
                maxTokens,
                providerOptions,
                profile: scene.profile,
                stream: false,
              }),
            }
          : {}),
      };
      return response;
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  async *createChatCompletionStream(
    body: Record<string, unknown>,
    options: AiNovelLocalDebugOptions = {},
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
        exposeLocalDebug: options.exposeLocalDebug === true,
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
        exposeLocalDebug: options.exposeLocalDebug === true,
      });
      return;
    }

    let aggregatedContent = "";
    let aggregatedReasoning = "";
    let finishReason: string | undefined;
    let usage: AiNovelUsagePayload | undefined;
    const providerOptions: Record<string, unknown> | undefined = undefined;

    try {
      if (options.exposeLocalDebug === true) {
        yield this.buildLocalDebugLlmRequestChunk({
          taskType: scene.taskType,
          modelKey,
          messages,
          temperature,
          maxTokens,
          providerOptions,
        });
      }

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
    exposeLocalDebug: boolean;
  }): AsyncIterable<AiNovelChatStreamChunk> {
    let aggregatedContent = "";
    let aggregatedReasoning = "";
    let finishReason: string | undefined;
    let usage: AiNovelUsagePayload | undefined;
    let fallbackToolCallIndex = 0;
    const promptAssembly = buildAiNovelPromptAssembly({
      profile: input.profile,
      messages: input.messages,
      context: input.context,
    });
    const providerOptions = {
      tools: toOpenAiToolDefinitions(promptAssembly.tools),
      tool_choice: "auto",
    };

    try {
      if (input.exposeLocalDebug) {
        yield this.buildLocalDebugLlmRequestChunk({
          taskType: input.profile,
          modelKey: input.modelKey,
          messages: promptAssembly.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          providerOptions,
          profile: input.profile,
        });
      }

      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages: promptAssembly.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        providerOptions,
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
            toolCall: this.normalizePromptedSceneToolCall(
              event.toolCall,
              input.modelKey,
              fallbackToolCallIndex,
            ),
          };
          fallbackToolCallIndex += 1;
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
    exposeLocalDebug: boolean;
  }): AsyncIterable<AiNovelChatStreamChunk> {
    let assistantText = "";
    let reasoningText = "";
    let usage: AiNovelUsagePayload | undefined;
    let finishReason: string | undefined;
    let fallbackToolCallIndex = 0;
    const messages = this.buildKickoffMessages(input.messages, input.meta);
    const providerOptions = {
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
    };

    try {
      if (input.exposeLocalDebug) {
        yield this.buildLocalDebugLlmRequestChunk({
          taskType: "kickoff_turn",
          modelKey: input.modelKey,
          messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
          providerOptions,
        });
      }

      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        providerOptions,
      })) {
        if (event.type === "reasoning_delta") {
          reasoningText += event.text;
          yield {
            type: "reasoning_delta",
            text: event.text,
          };
          continue;
        }

        if (event.type === "content_delta") {
          assistantText += event.text;
          yield {
            type: "text_delta",
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

        if (event.type === "tool_call") {
          yield {
            type: "tool_call",
            toolCall: {
              ...event.toolCall,
              id: this.normalizeToolCallId(
                event.toolCall.id,
                this.buildFallbackToolCallId(
                  input.modelKey,
                  "kickoff",
                  fallbackToolCallIndex,
                ),
              ),
            },
          };
          fallbackToolCallIndex += 1;
          continue;
        }

        finishReason = event.finishReason;
        yield {
          type: "done",
          completion: {
            modelKey: input.modelKey,
            content: assistantText,
            ...(reasoningText ? { reasoningText } : {}),
            ...(finishReason ? { finishReason } : {}),
          },
          ...(usage ? { usage } : {}),
        };
      }
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
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

  private buildLocalDebugLlmRequestPayload(input: {
    taskType: string;
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    providerOptions?: Record<string, unknown>;
    profile?: AiNovelPromptProfile;
    stream: boolean;
  }): AiNovelLocalDebugLlmRequestPayload {
    return {
      taskType: input.taskType,
      modelKey: input.modelKey,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      ...(input.profile ? { profile: input.profile } : {}),
      requestBody: {
        modelKey: input.modelKey,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        stream: input.stream,
        ...(input.providerOptions
          ? { providerOptions: input.providerOptions }
          : {}),
      },
    };
  }

  private buildLocalDebugLlmRequestChunk(input: {
    taskType: string;
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    providerOptions?: Record<string, unknown>;
    profile?: AiNovelPromptProfile;
  }): AiNovelChatStreamChunk {
    return {
      type: "local_debug_llm_request",
      payload: this.buildLocalDebugLlmRequestPayload({
        ...input,
        stream: true,
      }),
    };
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
      chapterLength.minChars !== undefined &&
      chapterLength.maxChars !== undefined
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

  private normalizeChapterLengthContext(value: unknown): KickoffChapterLength {
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

  private normalizeStoryAnchors(
    value: unknown,
    maxItems: number,
  ): StoryAnchor[] {
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
      const name = this.readOptionalString(item.name);
      const role = this.readOptionalString(item.role);
      if (!label || !role || seen.has(label)) {
        continue;
      }
      anchors.push({
        label,
        ...(name ? { name } : {}),
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

  private normalizePromptedSceneToolCall(
    toolCall: LLMToolCall,
    modelKey: string,
    fallbackIndex: number,
  ): LLMToolCall {
    const id = this.normalizeToolCallId(
      toolCall.id,
      this.buildFallbackToolCallId(modelKey, "prompted", fallbackIndex),
    );
    const name = this.readOptionalString(toolCall.name);
    if (!name) {
      throw new ApplicationError(
        502,
        "LLM_PROVIDER_RESPONSE_INVALID",
        "Provider emitted a prompted-scene tool call without a name.",
        { modelKey, toolCallId: id },
      );
    }

    return {
      id,
      name,
      input: isRecord(toolCall.input) ? toolCall.input : {},
    };
  }

  private normalizeToolCallId(value: unknown, fallbackId: string): string {
    return this.readOptionalString(value) ?? fallbackId;
  }

  private buildFallbackToolCallId(
    modelKey: string,
    phase: "kickoff" | "prompted",
    index: number,
  ): string {
    return `${modelKey}_${phase}_tool_${index}`;
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
