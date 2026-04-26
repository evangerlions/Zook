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
  storyCenter: string[];
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
  length: string;
  povCount: string;
  threadCount: string;
  pace: string;
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

type KickoffToolKind =
  (typeof kickoffToolWireNames)[keyof typeof kickoffToolWireNames];

const kickoffToolKindByWireName = new Map<string, KickoffToolKind>(
  Object.values(kickoffToolWireNames).map((name) => [name, name]),
);

const kickoffToolDefinitions: LLMToolDefinition[] = [
  {
    name: kickoffToolWireNames.readMeta,
    description: "Read the full current kickoff premise draft.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: kickoffToolWireNames.updateMeta,
    description:
      "Patch one or more fields in the current kickoff premise draft.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleCandidate: { type: "string" },
        readiness: { type: "number" },
        storyPromise: { type: "string" },
        storyCenter: { type: "array", items: { type: "string" } },
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
        premiseScale: {
          type: "object",
          additionalProperties: false,
          properties: {
            length: { type: "string" },
            povCount: { type: "string" },
            threadCount: { type: "string" },
            pace: { type: "string" },
          },
        },
        language: { type: "string" },
        toneRegister: { type: "string" },
        extras: { type: "object" },
      },
    },
  },
  {
    name: kickoffToolWireNames.askQuestion,
    description:
      "Ask one focused kickoff question with 2-4 user-facing options. optionSubtitles are optional; when provided, they should align one-to-one with options so the UI can render short explanatory subtitles directly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "options"],
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        optionSubtitles: {
          type: "array",
          description:
            "Optional short subtitle for each option. Only include this field when subtitles add real value. If provided, it must align one-to-one with options and be suitable for direct UI display.",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        allowCustom: { type: "boolean" },
      },
    },
  },
  {
    name: kickoffToolWireNames.ready,
    description: "Declare the kickoff sufficient to start writing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
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
  "7. Call ready only when storyPromise, storyCenter, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, and toneRegister are sufficiently clear.",
  "8. If the user says you may decide or start directly, infer sensible defaults from the conversation, call update_meta with every required canonical field first, then call ready only after those fields are non-empty.",
  "",
  "## Question rules",
  "- Ask one question at a time.",
  "- Offer 2 to 4 concrete, user-facing, mutually distinguishable options.",
  "- Do not ask broad questionnaires.",
  "- Do not ask for information already clear from the conversation or summary.",
  "",
  "## Meta rules",
  "- Update only fields that are more certain now.",
  "- Use canonical premise fields as the durable contract: storyPromise, storyCenter, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, toneRegister, extras.",
  "- Use titleCandidate only for the candidate book title; the client derives kickoff card UI text from the canonical premise.",
  "- Do not speculate.",
  "- Keep readiness conservative.",
  "- Do not inflate readiness just because the idea sounds promising.",
  "",
  "## Ready rules",
  "- Do not call ready early.",
  "- Use ready only when the canonical premise/contract fields are sufficiently clear to start writing.",
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
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    }
  | {
      type: "done";
      completion: {
        modelKey: string;
        content: string;
        reasoningText?: string;
        finishReason?: string;
      };
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
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
    let usage:
      | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        }
      | undefined;

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
    let usage:
      | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        }
      | undefined;
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
    let assistantText = "";
    let reasoningText = "";
    let usage:
      | {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        }
      | undefined;
    let finishReason: string | undefined;
    const toolCalls: LLMToolCall[] = [];

    try {
      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages: this.buildKickoffMessages(input.messages, input.meta),
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

    for (const [index, toolCall] of toolCalls.entries()) {
      const normalizedToolCallId =
        toolCall.id && toolCall.id.trim().length > 0
          ? toolCall.id
          : `${input.modelKey}_kickoff_tool_${index}`;
      const toolKind = kickoffToolKindByWireName.get(toolCall.name);
      if (!toolKind) {
        yield {
          type: "error",
          payload: {
            code: "KICKOFF_TOOL_UNKNOWN",
            message: `Unknown kickoff tool: ${toolCall.name}`,
            recoverable: false,
          },
        };
        if (usage) {
          yield {
            type: "usage",
            usage,
          };
        }
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
        return;
      }
      const normalizedToolCall = this.normalizeKickoffToolCall(
        {
          id: normalizedToolCallId,
          name: toolCall.name,
          input: toolCall.input,
        },
        toolKind,
      );
      if (!normalizedToolCall) {
        yield {
          type: "error",
          payload: {
            code: "KICKOFF_TOOL_INVALID_PAYLOAD",
            message: `Invalid kickoff tool payload: ${toolCall.name}`,
            recoverable: true,
          },
        };
        if (usage) {
          yield {
            type: "usage",
            usage,
          };
        }
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
        return;
      }
      yield {
        type: "tool_call",
        toolCall: {
          id: normalizedToolCall.id,
          name: normalizedToolCall.name,
          input: normalizedToolCall.input,
        },
      };
    }

    if (usage) {
      yield {
        type: "usage",
        usage,
      };
    }
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
      `- storyCenter: ${meta.storyCenter.join(" / ")}`,
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
      `- premiseScale.length: ${meta.premiseScale.length}`,
      `- premiseScale.povCount: ${meta.premiseScale.povCount}`,
      `- premiseScale.threadCount: ${meta.premiseScale.threadCount}`,
      `- premiseScale.pace: ${meta.premiseScale.pace}`,
      `- language: ${meta.language}`,
      `- toneRegister: ${meta.toneRegister}`,
    ].join("\n");
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
      storyCenter: this.normalizeKickoffQuestionStrings(meta.storyCenter, 12),
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
      length: this.readOptionalString(record.length) ?? "",
      povCount: this.readOptionalString(record.povCount) ?? "",
      threadCount: this.readOptionalString(record.threadCount) ?? "",
      pace: this.readOptionalString(record.pace) ?? "",
    };
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
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
  ): LLMToolCall | undefined {
    const normalizer = this.kickoffToolNormalizers[toolKind];
    return normalizer(toolCall);
  }

  private readonly kickoffToolNormalizers: Record<
    KickoffToolKind,
    (toolCall: LLMToolCall) => LLMToolCall | undefined
  > = {
    [kickoffToolWireNames.askQuestion]: (toolCall) =>
      this.normalizeKickoffAskQuestionToolCall(toolCall),
    [kickoffToolWireNames.updateMeta]: (toolCall) =>
      this.normalizeKickoffUpdateMetaToolCall(toolCall),
    [kickoffToolWireNames.readMeta]: (toolCall) =>
      this.emptyPayloadKickoffToolCall(toolCall),
    [kickoffToolWireNames.ready]: (toolCall) =>
      this.emptyPayloadKickoffToolCall(toolCall),
  };

  private emptyPayloadKickoffToolCall(toolCall: LLMToolCall): LLMToolCall {
    return {
      id: toolCall.id,
      name: toolCall.name,
      input: {},
    };
  }

  private normalizeKickoffAskQuestionToolCall(
    toolCall: LLMToolCall,
  ): LLMToolCall | undefined {
    const reasons = new Set<string>();
    const question = this.readOptionalString(toolCall.input.question);
    if (typeof toolCall.input.question !== "string") {
      reasons.add("question_missing_or_not_string");
    } else if (toolCall.input.question.trim() !== toolCall.input.question) {
      reasons.add("question_trimmed");
    }
    const options = this.normalizeKickoffQuestionStrings(
      toolCall.input.options,
      4,
    );
    if (!Array.isArray(toolCall.input.options)) {
      reasons.add("options_missing_or_not_array");
    } else {
      const rawOptions = toolCall.input.options;
      if (rawOptions.length > 4) {
        reasons.add("options_truncated_to_contract");
      }
      if (rawOptions.length !== options.length) {
        reasons.add("options_filtered_or_deduplicated");
      }
    }
    if (!question || options.length < 2) {
      if (options.length < 2) {
        reasons.add("options_below_minimum_after_normalization");
      }
      this.logKickoffCompatibilityFallback({
        toolCall,
        reasons: [...reasons],
      });
      return undefined;
    }

    const input: Record<string, unknown> = {
      question,
      options,
    };
    const optionSubtitles = this.normalizeKickoffQuestionStrings(
      toolCall.input.optionSubtitles,
      options.length,
    );
    if (toolCall.input.optionSubtitles !== undefined) {
      if (!Array.isArray(toolCall.input.optionSubtitles)) {
        reasons.add("option_subtitles_not_array");
      } else if (optionSubtitles.length !== options.length) {
        reasons.add("option_subtitles_dropped_for_alignment");
      } else if (
        toolCall.input.optionSubtitles.length !== optionSubtitles.length
      ) {
        reasons.add("option_subtitles_filtered_or_trimmed");
      }
    }
    if (optionSubtitles.length === options.length) {
      input.optionSubtitles = optionSubtitles;
    }
    if (toolCall.input.allowCustom === true) {
      input.allowCustom = true;
    } else if (toolCall.input.allowCustom !== undefined) {
      reasons.add("allow_custom_ignored");
    }
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input,
    };
    this.logKickoffCompatibilityFallback({
      toolCall,
      normalizedToolCall,
      reasons: [...reasons],
    });
    return normalizedToolCall;
  }

  private normalizeKickoffUpdateMetaToolCall(
    toolCall: LLMToolCall,
  ): LLMToolCall {
    const reasons = new Set<string>();
    const input: Record<string, unknown> = {};
    const titleCandidate =
      this.readOptionalString(toolCall.input.titleCandidate) ??
      this.readOptionalString(toolCall.input.title) ??
      this.readOptionalString(toolCall.input.bookTitle);
    const storyPromise =
      this.readOptionalString(toolCall.input.storyPromise) ??
      this.readOptionalString(toolCall.input.logline) ??
      this.readOptionalString(toolCall.input.summary);
    const storyCenter = this.readKickoffStoryCenter(toolCall.input);
    const changeHorizon =
      this.readOptionalString(toolCall.input.changeHorizon) ??
      this.readOptionalString(toolCall.input.storyDirection);
    const premiseScale = this.readKickoffPremiseScale(toolCall.input);
    const knownKeys = new Set([
      "titleCandidate",
      "title",
      "bookTitle",
      "readiness",
      "storyPromise",
      "logline",
      "summary",
      "storyCenter",
      "protagonistAndHook",
      "protagonist",
      "focalization",
      "startState",
      "trigger",
      "drive",
      "pressureSources",
      "stakes",
      "worldConstraints",
      "changeHorizon",
      "storyDirection",
      "premiseScale",
      "scale",
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
      if (toolCall.input.titleCandidate === undefined) {
        reasons.add("legacy_title_mapped");
      } else if (toolCall.input.titleCandidate !== titleCandidate) {
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
      if (toolCall.input.storyPromise === undefined) {
        reasons.add("legacy_story_promise_mapped");
      } else if (toolCall.input.storyPromise !== storyPromise) {
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
      if (toolCall.input.changeHorizon === undefined) {
        reasons.add("legacy_change_horizon_mapped");
      } else if (toolCall.input.changeHorizon !== changeHorizon) {
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
    if (storyCenter.length > 0) {
      input.storyCenter = storyCenter;
      if (toolCall.input.storyCenter === undefined) {
        reasons.add("legacy_story_center_mapped");
      } else {
        const rawValue = toolCall.input.storyCenter;
        if (
          !Array.isArray(rawValue) ||
          storyCenter.length !== rawValue.length
        ) {
          reasons.add("storyCenter_normalized");
        }
      }
    } else if (toolCall.input.storyCenter !== undefined) {
      reasons.add("storyCenter_dropped");
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
      if (toolCall.input.premiseScale === undefined) {
        reasons.add("legacy_scale_mapped");
      }
    } else if (toolCall.input.premiseScale !== undefined) {
      reasons.add("premiseScale_dropped");
    }
    this.copyOptionalObjectField(toolCall.input, input, reasons, "extras");
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      input,
    };
    this.logKickoffCompatibilityFallback({
      toolCall,
      normalizedToolCall,
      reasons: [...reasons],
    });
    return normalizedToolCall;
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

  private readKickoffStoryCenter(source: Record<string, unknown>): string[] {
    const canonical = this.normalizeKickoffQuestionStrings(
      source.storyCenter,
      12,
    );
    if (canonical.length > 0) {
      return canonical;
    }
    const legacy =
      this.readOptionalString(source.protagonistAndHook) ??
      this.readOptionalString(source.protagonist);
    return legacy ? [legacy] : [];
  }

  private readKickoffPremiseScale(
    source: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (isRecord(source.premiseScale)) {
      return source.premiseScale;
    }
    if (isRecord(source.scale)) {
      return source.scale;
    }
    const legacyLength = this.readOptionalString(source.scale);
    if (legacyLength) {
      return { length: legacyLength };
    }
    return undefined;
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

  private logKickoffCompatibilityFallback(input: {
    toolCall: LLMToolCall;
    reasons: string[];
    normalizedToolCall?: LLMToolCall;
  }): void {
    if (!this.logger || input.reasons.length === 0) {
      return;
    }
    this.logger.error("ai_novel kickoff compatibility fallback applied", {
      taskType: "kickoff_turn",
      toolName: input.toolCall.name,
      toolCallId: input.toolCall.id,
      reasons: input.reasons,
      originalInput: input.toolCall.input,
      ...(input.normalizedToolCall
        ? { normalizedInput: input.normalizedToolCall.input }
        : {}),
    });
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
