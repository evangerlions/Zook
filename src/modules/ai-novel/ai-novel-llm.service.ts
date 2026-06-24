import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type {
  LLMMessage,
  LLMManager,
  LLMCompletionResult,
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
import type { ContentSafetyService } from "../../services/content-safety.service.ts";
import type { AiNovelModelRoutingTier } from "../../shared/types.ts";
import {
  resolveAiNovelChatScene,
  resolveAiNovelEmbeddingScene,
} from "./ai-novel-llm-scenes.ts";
import {
  buildAiNovelPromptAssembly,
  toOpenAiToolDefinitions,
} from "./ai-novel-llm-prompts.ts";
import type { AiNovelPromptProfile } from "./ai-novel-llm-prompts.ts";
import {
  adaptBasicAiNovelStream,
  adaptKickoffAiNovelStream,
  adaptPromptedAiNovelStream,
} from "./ai-novel-llm-stream-adapter.ts";
import {
  buildKickoffMessages,
  normalizeKickoffMetaContext,
} from "./ai-novel-kickoff-context.ts";
import { kickoffToolDefinitions } from "./ai-novel-kickoff-tools.ts";
import type { KickoffMeta } from "./ai-novel-kickoff-types.ts";
import {
  assertNoClientModelSelection,
  isRecord,
  normalizeEmbeddingInput,
  normalizeMessages,
  optionalNumber,
  optionalPositiveInteger,
  readOptionalString,
  requireSceneKey,
} from "./ai-novel-llm-request-validation.ts";
import { mapAndLogAiNovelUpstreamError } from "./ai-novel-upstream-errors.ts";
import {
  completeRequiredToolViaStream,
  resolvePromptAssemblyCompletionText,
} from "./ai-novel-required-tool-completer.ts";
import {
  buildLocalDebugLlmRequestChunk,
  buildLocalDebugLlmRequestPayload,
} from "./ai-novel-local-debug-request.ts";
import type { AiNovelLocalDebugLlmRequestPayload } from "./ai-novel-local-debug-request.ts";

export interface AiNovelChatResponse {
  sceneKey: string;
  completion: {
    sceneRouteKey: string;
    provider: string;
    providerModel: string;
    content: string;
    toolCalls?: LLMToolCall[];
    reasoningText?: string;
    finishReason?: string;
    providerRequestId?: string;
  };
  localDebugLlmRequest?: AiNovelLocalDebugLlmRequestPayload;
}

export interface AiNovelUsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
}

interface AiNovelRequestOptions {
  exposeLocalDebug?: boolean;
  requestId?: string;
  routingTier?: AiNovelModelRoutingTier;
  locale?: string;
}

export type AiNovelChatStreamChunk =
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
      type: "tool_call_delta";
      text: string;
      toolCallId?: string;
      toolCallName?: string;
      toolArgumentPath?: string;
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
        sceneRouteKey: string;
        content: string;
        reasoningText?: string;
        finishReason?: string;
      };
      usage?: AiNovelUsagePayload;
    };

export interface AiNovelEmbeddingsResponse {
  sceneKey: string;
  sceneRouteKey: string;
  provider: string;
  providerModel: string;
  vectors: EmbeddingVector[];
  providerRequestId?: string;
}

export class AiNovelLlmService {
  private static readonly STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS = 20_000;
  private static readonly IMPORT_BOOK_STREAM_FIRST_EVENT_TIMEOUT_MS = 120_000;
  private static readonly IMPORT_BOOK_STREAM_IDLE_TIMEOUT_MS = 90_000;

  constructor(
    private readonly llmManager: LLMManager,
    private readonly embeddingManager: EmbeddingManager,
    private readonly appAiRoutingConfigService: AppAiRoutingConfigService,
    private readonly logger?: StructuredLogger,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  async createChatCompletion(
    body: Record<string, unknown>,
    options: AiNovelRequestOptions = {},
  ): Promise<AiNovelChatResponse> {
    assertNoClientModelSelection(body);

    const sceneKey = requireSceneKey(body);
    const scene = resolveAiNovelChatScene(sceneKey);
    if (scene.sceneKey === "kickoff_turn") {
      badRequest("REQ_INVALID_BODY", "kickoff_turn requires stream=true.");
    }
    if (scene.requiresStream) {
      badRequest("REQ_INVALID_BODY", `${scene.sceneKey} requires stream=true.`);
    }
    const sceneRouteKey =
      await this.appAiRoutingConfigService.resolveSceneRouteKey(
        AI_NOVEL_APP_ID,
        "chat",
        scene.sceneKey,
        options.routingTier,
      );
    const messages = normalizeMessages(body.messages);
    await this.assertLatestUserInputAllowed(body, messages, scene.sceneKey);
    const promptAssembly = scene.profile
      ? buildAiNovelPromptAssembly({
          profile: scene.profile,
          messages,
          context: body.context,
        })
      : { messages, tools: [] };
    const temperature =
      optionalNumber(body.temperature, "temperature") ??
      scene.defaultTemperature;
    const maxTokens =
      optionalPositiveInteger(body.maxTokens, "maxTokens") ??
      scene.defaultMaxTokens;
    const shouldUseStreamedCompletion = Boolean(scene.completeViaStream);
    const providerOptions = this.buildPromptedSceneProviderOptions(
      scene.profile,
      promptAssembly.tools,
      shouldUseStreamedCompletion || scene.profile === "import_book_agent",
    );
    try {
      const llmRequest = {
        modelKey: sceneRouteKey,
        modelKeyKind: "scene_route" as const,
        messages: promptAssembly.messages,
        temperature,
        maxTokens,
        ...(providerOptions ? { providerOptions } : {}),
      };
      const result: LLMCompletionResult =
        shouldUseStreamedCompletion && promptAssembly.forcedToolName
          ? await completeRequiredToolViaStream(this.llmManager, {
              sceneRouteKey,
              messages: promptAssembly.messages,
              temperature,
              maxTokens,
              ...(providerOptions ? { providerOptions } : {}),
              forcedToolName: promptAssembly.forcedToolName,
            })
          : shouldUseStreamedCompletion
            ? await this.llmManager.completeViaStream(llmRequest, {
                firstContentTimeoutMs:
                  AiNovelLlmService.STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS,
              })
            : await this.llmManager.complete(llmRequest);
      const completionContent = resolvePromptAssemblyCompletionText(
        promptAssembly.forcedToolName,
        result,
      );

      const response: AiNovelChatResponse = {
        sceneKey: scene.sceneKey,
        completion: {
          sceneRouteKey: result.modelKey,
          provider: result.provider,
          providerModel: result.providerModel,
          content: completionContent,
          ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
          ...(result.reasoningText
            ? { reasoningText: result.reasoningText }
            : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.providerRequestId
            ? { providerRequestId: result.providerRequestId }
            : {}),
        },
        ...(options.exposeLocalDebug === true
          ? {
              localDebugLlmRequest: buildLocalDebugLlmRequestPayload({
                sceneKey: scene.sceneKey,
                sceneRouteKey,
                messages: promptAssembly.messages,
                temperature,
                maxTokens,
                providerOptions,
                profile: scene.profile,
                stream: shouldUseStreamedCompletion,
              }),
            }
          : {}),
      };
      return response;
    } catch (error) {
      throw this.mapAndLogUpstreamError(error, {
        stage: "chat",
        requestId: options.requestId,
        sceneKey: scene.sceneKey,
        sceneRouteKey,
        profile: scene.profile,
      });
    }
  }

  async *createChatCompletionStream(
    body: Record<string, unknown>,
    options: AiNovelRequestOptions = {},
  ): AsyncIterable<AiNovelChatStreamChunk> {
    assertNoClientModelSelection(body);

    const sceneKey = requireSceneKey(body);
    const scene = resolveAiNovelChatScene(sceneKey);
    if (scene.supportsStream === false) {
      badRequest("REQ_INVALID_BODY", `${scene.sceneKey} requires stream=false.`);
    }
    const sceneRouteKey =
      await this.appAiRoutingConfigService.resolveSceneRouteKey(
        AI_NOVEL_APP_ID,
        "chat",
        scene.sceneKey,
        options.routingTier,
      );
    const messages = normalizeMessages(body.messages);
    await this.assertLatestUserInputAllowed(body, messages, scene.sceneKey);
    const temperature =
      optionalNumber(body.temperature, "temperature") ??
      scene.defaultTemperature;
    const maxTokens =
      optionalPositiveInteger(body.maxTokens, "maxTokens") ??
      scene.defaultMaxTokens;

    try {
      if (scene.sceneKey === "kickoff_turn") {
        const kickoffMessages = buildKickoffMessages(
          messages,
          normalizeKickoffMetaContext(body.context),
          options.locale,
        );
        const providerOptions = {
          enable_thinking: true,
          tools: toOpenAiToolDefinitions(kickoffToolDefinitions),
          tool_choice: "auto",
        };
        if (options.exposeLocalDebug === true) {
          yield buildLocalDebugLlmRequestChunk({
            sceneKey: scene.sceneKey,
            sceneRouteKey,
            messages: kickoffMessages,
            temperature,
            maxTokens,
            providerOptions,
          });
        }
        yield* adaptKickoffAiNovelStream({
          sceneRouteKey,
          events: this.llmManager.stream({
            modelKey: sceneRouteKey,
            modelKeyKind: "scene_route",
            messages: kickoffMessages,
            temperature,
            maxTokens,
            providerOptions,
          }),
          normalizeToolCall: (toolCall, fallbackIndex) => ({
            ...toolCall,
            id: this.normalizeToolCallId(
              toolCall.id,
              this.buildFallbackToolCallId(sceneRouteKey, "kickoff", fallbackIndex),
            ),
          }),
        });
        return;
      }

      if (scene.profile === "kickoff_turn_imported_book") {
        const promptAssembly = buildAiNovelPromptAssembly({
          profile: scene.profile,
          messages,
          context: body.context,
        });
        const providerOptions = this.buildPromptedSceneProviderOptions(
          scene.profile,
          promptAssembly.tools,
          true,
        );
        if (options.exposeLocalDebug === true) {
          yield buildLocalDebugLlmRequestChunk({
            sceneKey: scene.sceneKey,
            sceneRouteKey,
            messages: promptAssembly.messages,
            temperature,
            maxTokens,
            providerOptions,
            profile: scene.profile,
          });
        }
        yield* adaptKickoffAiNovelStream({
          sceneRouteKey,
          events: this.llmManager.stream({
            modelKey: sceneRouteKey,
            modelKeyKind: "scene_route",
            messages: promptAssembly.messages,
            temperature,
            maxTokens,
            providerOptions,
          }),
          normalizeToolCall: (toolCall, fallbackIndex) =>
            this.normalizePromptedSceneToolCall(
              toolCall,
              sceneRouteKey,
              fallbackIndex,
            ),
        });
        return;
      }

      if (scene.profile) {
        const promptAssembly = buildAiNovelPromptAssembly({
          profile: scene.profile,
          messages,
          context: body.context,
        });
        const providerOptions = this.buildPromptedSceneProviderOptions(
          scene.profile,
          promptAssembly.tools,
          true,
        );
        if (options.exposeLocalDebug === true) {
          yield buildLocalDebugLlmRequestChunk({
            sceneKey: scene.sceneKey,
            sceneRouteKey,
            messages: promptAssembly.messages,
            temperature,
            maxTokens,
            providerOptions,
            profile: scene.profile,
          });
        }
        yield* adaptPromptedAiNovelStream({
          sceneRouteKey,
          profile: scene.profile,
          events: this.llmManager.stream({
            modelKey: sceneRouteKey,
            modelKeyKind: "scene_route",
            messages: promptAssembly.messages,
            temperature,
            maxTokens,
            providerOptions,
          }),
          normalizeToolCall: (toolCall, fallbackIndex) =>
            this.normalizePromptedSceneToolCall(
              toolCall,
              sceneRouteKey,
              fallbackIndex,
            ),
        });
        return;
      }

      if (options.exposeLocalDebug === true) {
        yield buildLocalDebugLlmRequestChunk({
          sceneKey: scene.sceneKey,
          sceneRouteKey,
          messages,
          temperature,
          maxTokens,
        });
      }
      yield* adaptBasicAiNovelStream({
        sceneRouteKey,
        events: this.llmManager.stream({
          modelKey: sceneRouteKey,
          modelKeyKind: "scene_route",
          messages,
          temperature,
          maxTokens,
        }),
      });
    } catch (error) {
      throw this.mapAndLogUpstreamError(error, {
        stage: "chat_stream",
        requestId: options.requestId,
        sceneKey: scene.sceneKey,
        sceneRouteKey,
        profile: scene.profile,
      });
    }
  }

  private normalizePromptedSceneToolCall(
    toolCall: LLMToolCall,
    sceneRouteKey: string,
    fallbackIndex: number,
  ): LLMToolCall {
    const id = this.normalizeToolCallId(
      toolCall.id,
      this.buildFallbackToolCallId(sceneRouteKey, "prompted", fallbackIndex),
    );
    const name = readOptionalString(toolCall.name);
    if (!name) {
      throw new ApplicationError(
        502,
        "LLM_PROVIDER_RESPONSE_INVALID",
        "Provider emitted a prompted-scene tool call without a name.",
        { sceneRouteKey, toolCallId: id },
      );
    }

    return {
      id,
      name,
      input: isRecord(toolCall.input) ? toolCall.input : {},
    };
  }

  private buildPromptedSceneProviderOptions(
    profile: AiNovelPromptProfile | undefined,
    tools: ReturnType<typeof buildAiNovelPromptAssembly>["tools"],
    enableThinking: boolean,
  ): Record<string, unknown> | undefined {
    if (!enableThinking && tools.length === 0) {
      return undefined;
    }
    return {
      ...(enableThinking ? { enable_thinking: true } : {}),
      ...(tools.length > 0
        ? {
            tools: toOpenAiToolDefinitions(tools),
            tool_choice: "auto",
          }
        : {}),
      ...(profile === "import_book_agent"
        ? {
            stream_options: {
              first_event_timeout_ms:
                AiNovelLlmService.IMPORT_BOOK_STREAM_FIRST_EVENT_TIMEOUT_MS,
              idle_timeout_ms:
                AiNovelLlmService.IMPORT_BOOK_STREAM_IDLE_TIMEOUT_MS,
            },
          }
        : {}),
    };
  }

  private normalizeToolCallId(value: unknown, fallbackId: string): string {
    return readOptionalString(value) ?? fallbackId;
  }

  private buildFallbackToolCallId(
    sceneRouteKey: string,
    phase: "kickoff" | "prompted",
    index: number,
  ): string {
    return `${sceneRouteKey}_${phase}_tool_${index}`;
  }

  async createEmbeddings(
    body: Record<string, unknown>,
    options: AiNovelRequestOptions = {},
  ): Promise<AiNovelEmbeddingsResponse> {
    assertNoClientModelSelection(body);

    const sceneKey = requireSceneKey(body);
    const scene = resolveAiNovelEmbeddingScene(sceneKey);
    const sceneRouteKey =
      await this.appAiRoutingConfigService.resolveSceneRouteKey(
        AI_NOVEL_APP_ID,
        "embedding",
        scene.sceneKey,
        options.routingTier,
      );
    const input = normalizeEmbeddingInput(body.input);

    try {
      const result = await this.embeddingManager.embed({
        modelKey: sceneRouteKey,
        modelKeyKind: "scene_route",
        input,
      });

      return {
        sceneKey: scene.sceneKey,
        sceneRouteKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
        vectors: result.vectors,
        ...(result.providerRequestId
          ? { providerRequestId: result.providerRequestId }
          : {}),
      };
    } catch (error) {
      throw this.mapAndLogUpstreamError(error, {
        stage: "embedding",
        requestId: options.requestId,
        sceneKey: scene.sceneKey,
        sceneRouteKey,
      });
    }
  }

  private async assertLatestUserInputAllowed(
    body: Record<string, unknown>,
    messages: LLMMessage[],
    sceneKey: string,
  ): Promise<void> {
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const content = latestUserMessage?.content?.trim();
    if (!content || !this.contentSafetyService) {
      return;
    }

    const context =
      body.context &&
      typeof body.context === "object" &&
      !Array.isArray(body.context)
        ? (body.context as Record<string, unknown>)
        : {};
    const userId =
      typeof context.userId === "string" ? context.userId : undefined;
    const requestId =
      typeof context.requestId === "string" ? context.requestId : undefined;
    await this.contentSafetyService.assertUserInputAllowed({
      appId: AI_NOVEL_APP_ID,
      userId,
      requestId,
      sceneKey,
      text: content,
    });
  }

  private mapAndLogUpstreamError(
    error: unknown,
    context: {
      stage: "chat" | "chat_stream" | "embedding";
      requestId?: string;
      sceneKey: string;
      sceneRouteKey: string;
      profile?: AiNovelPromptProfile;
    },
  ): unknown {
    return mapAndLogAiNovelUpstreamError(error, context, this.logger);
  }
}
