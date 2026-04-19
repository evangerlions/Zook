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
      type: "action.update_meta";
      payload: Partial<KickoffMeta>;
    }
  | {
      type: "action.ask_question";
      payload: {
        question: string;
        options: string[];
        allowCustom?: boolean;
      };
    }
  | {
      type: "action.ready";
      payload: Record<string, never>;
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
    if (scene.taskType === "setup_turn") {
      badRequest(
        "REQ_INVALID_BODY",
        "setup_turn requires stream=true.",
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
    if (scene.taskType === "setup_turn") {
      yield* this.createSetupTurnStream({
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

  private async *createSetupTurnStream(input: {
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    meta: KickoffMeta;
  }): AsyncIterable<AiNovelChatStreamChunk> {
    const usageByLoop: Array<{
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }> = [];
    let currentMeta: KickoffMeta = input.meta;
    let conversation = this.buildKickoffMessages(input.messages, currentMeta);
    let finalContent = "";
    let finalReasoning = "";

    for (let loopIndex = 0; loopIndex < 6; loopIndex += 1) {
      let assistantText = "";
      let reasoningText = "";
      let usage:
        | {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          }
        | undefined;
      const toolCalls: LLMToolCall[] = [];
      let finishReason: string | undefined;

      for await (const event of this.llmManager.stream({
        modelKey: input.modelKey,
        messages: conversation,
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

        if (event.type === "done") {
          finishReason = event.finishReason;
        }
      }

      if (usage) {
        usageByLoop.push(usage);
      }
      finalContent += assistantText;
      finalReasoning += reasoningText;

      const normalizedToolCalls = toolCalls.map((toolCall, index) => ({
        ...toolCall,
        id: toolCall.id || `kickoff_tool_${loopIndex}_${index}`,
      }));
      const assistantMessage: LLMMessage = {
        role: "assistant",
        ...(assistantText ? { content: assistantText } : { content: "" }),
        ...(normalizedToolCalls.length > 0 ? { toolCalls: normalizedToolCalls } : {}),
      };
      conversation = [...conversation, assistantMessage];

      if (normalizedToolCalls.length === 0) {
        const finalUsage = usageByLoop.length > 0
          ? usageByLoop[usageByLoop.length - 1]
          : undefined;
        if (finalUsage) {
          yield {
            type: "usage",
            usage: finalUsage,
          };
        }
        yield {
          type: "done",
          completion: {
            modelKey: input.modelKey,
            content: finalContent,
            ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
            ...(finishReason ? { finishReason } : {}),
          },
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
        return;
      }

      let sawTerminalTool = false;
      const toolMessages: LLMMessage[] = [];

      for (const toolCall of normalizedToolCalls) {
        switch (toolCall.name) {
          case "read_meta": {
            toolMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: JSON.stringify(currentMeta),
            });
            break;
          }
          case "update_meta": {
            const patch = this.extractMetaPatch(toolCall.input);
            currentMeta = {
              ...currentMeta,
              ...patch,
            };
            yield {
              type: "action.update_meta",
              payload: patch,
            };
            toolMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: JSON.stringify({
                ok: true,
                appliedKeys: Object.keys(patch),
              }),
            });
            break;
          }
          case "ask_question": {
            if (sawTerminalTool) {
              badRequest(
                "LLM_PROVIDER_RESPONSE_INVALID",
                "setup_turn may emit only one terminal kickoff tool per turn.",
              );
            }
            sawTerminalTool = true;
            const options = this.asStringList(toolCall.input.options);
            if (options.length < 2 || options.length > 4) {
              badRequest(
                "LLM_PROVIDER_RESPONSE_INVALID",
                "ask_question requires 2 to 4 options.",
              );
            }
            yield {
              type: "action.ask_question",
              payload: {
                question:
                  this.readOptionalString(toolCall.input.question) ?? "继续补充",
                options,
                ...(toolCall.input.allowCustom === true
                  ? { allowCustom: true }
                  : {}),
              },
            };
            toolMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: JSON.stringify({
                ok: true,
                optionsCount: options.length,
              }),
            });
            break;
          }
          case "ready": {
            if (sawTerminalTool) {
              badRequest(
                "LLM_PROVIDER_RESPONSE_INVALID",
                "setup_turn may emit only one terminal kickoff tool per turn.",
              );
            }
            sawTerminalTool = true;
            yield {
              type: "action.ready",
              payload: {},
            };
            toolMessages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: JSON.stringify({ ok: true }),
            });
            break;
          }
          default: {
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
                content: finalContent,
                ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
                ...(finishReason ? { finishReason } : {}),
              },
              ...(usage ? { usage } : {}),
            };
            return;
          }
        }
      }

      const finalUsage = usageByLoop.length > 0
        ? usageByLoop[usageByLoop.length - 1]
        : undefined;
      if (sawTerminalTool) {
        if (finalUsage) {
          yield {
            type: "usage",
            usage: finalUsage,
          };
        }
        yield {
          type: "done",
          completion: {
            modelKey: input.modelKey,
            content: finalContent,
            ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
            ...(finishReason ? { finishReason } : {}),
          },
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
        return;
      }

      const onlyReadMeta = normalizedToolCalls.length > 0 &&
        normalizedToolCalls.every((toolCall) => toolCall.name === "read_meta");
      if (onlyReadMeta) {
        conversation = [...conversation, ...toolMessages];
        continue;
      }

      if (finalUsage) {
        yield {
          type: "usage",
          usage: finalUsage,
        };
      }
      yield {
        type: "done",
        completion: {
          modelKey: input.modelKey,
          content: finalContent,
          ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
          ...(finishReason ? { finishReason } : {}),
        },
        ...(finalUsage ? { usage: finalUsage } : {}),
      };
      return;
    }

    const finalUsage = usageByLoop.length > 0
      ? usageByLoop[usageByLoop.length - 1]
      : undefined;
    yield {
      type: "error",
      payload: {
        code: "KICKOFF_TOOL_LOOP_EXCEEDED",
        message: "setup_turn exceeded maximum tool loop depth.",
        recoverable: false,
      },
    };
    if (finalUsage) {
      yield {
        type: "usage",
        usage: finalUsage,
      };
    }
    yield {
      type: "done",
      completion: {
        modelKey: input.modelKey,
        content: finalContent,
        ...(finalReasoning ? { reasoningText: finalReasoning } : {}),
      },
      ...(finalUsage ? { usage: finalUsage } : {}),
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

  private extractMetaPatch(value: unknown): Partial<KickoffMeta> {
    if (!isRecord(value)) {
      return {};
    }
    const patch: Partial<KickoffMeta> = {};
    for (const key of [
      "title",
      "logline",
      "protagonistAndHook",
      "storyDirection",
      "scale",
    ] as const) {
      const next = this.readOptionalString(value[key]);
      if (next !== undefined) {
        patch[key] = next;
      }
    }
    if (value.readiness !== undefined) {
      patch.readiness = this.normalizeReadiness(value.readiness);
    }
    if (Object.keys(patch).length === 0) {
      badRequest(
        "LLM_PROVIDER_RESPONSE_INVALID",
        "update_meta must include at least one valid field.",
      );
    }
    return patch;
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
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

      const role = (item as Record<string, unknown>).role;
      const content = (item as Record<string, unknown>).content;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        badRequest(
          "REQ_INVALID_BODY",
          `Unsupported LLM role: ${String(role)}.`,
        );
      }

      if (typeof content !== "string" || !content.trim()) {
        badRequest(
          "REQ_INVALID_BODY",
          "Each message content must be a non-empty string.",
        );
      }

      return {
        role,
        content: content.trim(),
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
