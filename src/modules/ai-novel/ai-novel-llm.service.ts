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
import {
  resolveAiNovelChatScene,
  resolveAiNovelEmbeddingScene,
} from "./ai-novel-llm-scenes.ts";


interface KickoffMeta {
  title: string;
  logline: string;
  protagonistAndHook: string;
  storyDirection: string;
  scale: string;
  readiness: number;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const kickoffToolDefinitions: LLMToolDefinition[] = [
  {
    name: "read_meta",
    description: "Read the full current kickoff meta card.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "update_meta",
    description: "Replace one or more fields in the current kickoff meta card.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        logline: { type: "string" },
        protagonistAndHook: { type: "string" },
        storyDirection: { type: "string" },
        scale: { type: "string" },
        readiness: { type: "number" },
      },
    },
  },
  {
    name: "ask_question",
    description: "Ask one focused kickoff question with 2-4 user-facing options.",
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
        allowCustom: { type: "boolean" },
      },
    },
  },
  {
    name: "ready",
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
  "7. Call ready only when concept, protagonist/hook, direction, and workable scope are sufficiently clear.",
  "",
  "## Question rules",
  "- Ask one question at a time.",
  "- Offer 2 to 4 concrete, user-facing, mutually distinguishable options.",
  "- Do not ask broad questionnaires.",
  "- Do not ask for information already clear from the conversation or summary.",
  "",
  "## Meta rules",
  "- Update only fields that are more certain now.",
  "- Do not speculate.",
  "- Keep readiness conservative.",
  "- Do not inflate readiness just because the idea sounds promising.",
  "",
  "## Ready rules",
  "- Do not call ready early.",
  "- Use ready only when concept, protagonist/hook, direction, and workable scope are sufficiently clear.",
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
      badRequest(
        "REQ_INVALID_BODY",
        "kickoff_turn requires stream=true.",
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
    try {
      const result = await this.llmManager.complete({
        modelKey,
        messages,
        temperature,
        maxTokens,
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
      if (!kickoffToolDefinitions.some((tool) => tool.name === toolCall.name)) {
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
      yield {
        type: "tool_call",
        toolCall: {
          id: normalizedToolCallId,
          name: toolCall.name,
          input: toolCall.input,
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

  private buildKickoffMessages(messages: LLMMessage[], meta: KickoffMeta): LLMMessage[] {
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
      `- title: ${meta.title}`,
      `- logline: ${meta.logline}`,
      `- storyDirection: ${meta.storyDirection}`,
      `- scale: ${meta.scale}`,
      `- readiness: ${meta.readiness.toFixed(2)}`,
    ].join("\n");
  }

  private normalizeKickoffMetaContext(value: unknown): KickoffMeta {
    const meta = isRecord(value) && isRecord(value.meta)
      ? (value.meta as Record<string, unknown>)
      : isRecord(value)
        ? (value as Record<string, unknown>)
        : {};
    return {
      title: this.readOptionalString(meta.title) ?? "待定书名",
      logline: this.readOptionalString(meta.logline) ?? "",
      protagonistAndHook: this.readOptionalString(meta.protagonistAndHook) ?? "",
      storyDirection: this.readOptionalString(meta.storyDirection) ?? "",
      scale: this.readOptionalString(meta.scale) ?? "待定",
      readiness: this.normalizeReadiness(meta.readiness),
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
      badRequest("REQ_INVALID_BODY", "toolCalls must be an array when provided.");
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
