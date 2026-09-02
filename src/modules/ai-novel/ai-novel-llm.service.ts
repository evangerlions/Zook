import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type {
  LLMMessage,
  LLMManager,
  LLMCompletionResult,
} from "../../services/llm-manager.ts";
import type {
  EmbeddingManager,
} from "../../services/embedding-manager.ts";
import {
  AppAiRoutingConfigService,
  AI_NOVEL_APP_ID,
} from "../../services/app-ai-routing-config.service.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { ContentSafetyService } from "../../services/content-safety.service.ts";
import type {
  AccountRegion,
  AiNovelModelRoutingTier,
} from "../../shared/types.ts";
import {
  resolveAiNovelChatScene,
  resolveAiNovelEmbeddingScene,
} from "./ai-novel-llm-scenes.ts";
import {
  buildAiNovelCompletionRequestPlan,
  buildAiNovelStreamRequestPlan,
} from "./ai-novel-chat-request-plan.ts";
import type { AiNovelPromptProfile } from "./prompts/ai-novel-prompt-types.ts";
import {
  adaptBasicAiNovelStream,
  adaptKickoffAiNovelStream,
  adaptPromptedAiNovelStream,
} from "./ai-novel-llm-stream-adapter.ts";
import {
  assertNoClientModelSelection,
  normalizeEmbeddingInput,
  normalizeMessages,
  optionalNumber,
  optionalPositiveInteger,
  requireSceneKey,
} from "./ai-novel-llm-request-validation.ts";
import {
  aiNovelUsageOwner,
  buildAiNovelFallbackToolCallId,
  normalizeAiNovelPromptedToolCall,
  normalizeAiNovelToolCallId,
} from "./ai-novel-llm-tool-call-utils.ts";
import { mapAndLogAiNovelUpstreamError } from "./ai-novel-upstream-errors.ts";
import {
  completeRequiredToolViaStream,
  resolvePromptAssemblyCompletionText,
} from "./ai-novel-required-tool-completer.ts";
import {
  buildLocalDebugLlmRequestChunk,
  buildLocalDebugLlmRequestPayload,
} from "./ai-novel-local-debug-request.ts";
import type {
  AiNovelChatResponse,
  AiNovelChatStreamChunk,
  AiNovelEmbeddingsResponse,
} from "./ai-novel-llm-types.ts";

export type {
  AiNovelChatResponse,
  AiNovelChatStreamChunk,
  AiNovelEmbeddingsResponse,
  AiNovelUsagePayload,
} from "./ai-novel-llm-types.ts";

interface AiNovelRequestOptions {
  exposeLocalDebug?: boolean;
  requestId?: string;
  routingTier?: AiNovelModelRoutingTier;
  userId?: string;
  locale?: string;
  accountRegion?: AccountRegion;
  signal?: AbortSignal;
}

export class AiNovelLlmService {
  private static readonly STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS = 20_000;

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
    const requestPlan = buildAiNovelCompletionRequestPlan({
      accountRegion: options.accountRegion,
      context: body.context,
      locale: options.locale,
      messages,
      scene,
    });
    const temperature =
      optionalNumber(body.temperature, "temperature") ??
      scene.defaultTemperature;
    const maxTokens =
      optionalPositiveInteger(body.maxTokens, "maxTokens") ??
      scene.defaultMaxTokens;
    const shouldUseStreamedCompletion = Boolean(scene.completeViaStream);
    try {
      const llmRequest = {
        modelKey: sceneRouteKey,
        modelKeyKind: "scene_route" as const,
        messages: requestPlan.messages,
        temperature,
        maxTokens,
        ...(requestPlan.providerOptions
          ? { providerOptions: requestPlan.providerOptions }
          : {}),
        ...aiNovelUsageOwner(options),
      };
      const result: LLMCompletionResult =
        shouldUseStreamedCompletion && requestPlan.forcedToolName
          ? await completeRequiredToolViaStream(this.llmManager, {
              sceneRouteKey,
              messages: requestPlan.messages,
              temperature,
              maxTokens,
              ...(requestPlan.providerOptions
                ? { providerOptions: requestPlan.providerOptions }
                : {}),
              ...aiNovelUsageOwner(options),
              forcedToolName: requestPlan.forcedToolName,
            })
          : shouldUseStreamedCompletion
            ? await this.llmManager.completeViaStream(llmRequest, {
                firstContentTimeoutMs:
                  AiNovelLlmService.STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS,
              })
            : await this.llmManager.complete(llmRequest);
      const completionContent = resolvePromptAssemblyCompletionText(
        requestPlan.forcedToolName,
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
                messages: requestPlan.messages,
                temperature,
                maxTokens,
                providerOptions: requestPlan.providerOptions,
                profile: requestPlan.profile,
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
    const llmRequestContext = {
      ...aiNovelUsageOwner(options),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    try {
      const requestPlan = buildAiNovelStreamRequestPlan({
        accountRegion: options.accountRegion,
        context: body.context,
        locale: options.locale,
        messages,
        scene,
      });
      if (options.exposeLocalDebug === true) {
        yield buildLocalDebugLlmRequestChunk({
          sceneKey: scene.sceneKey,
          sceneRouteKey,
          messages: requestPlan.messages,
          temperature,
          maxTokens,
          providerOptions: requestPlan.providerOptions,
          profile: requestPlan.profile,
        });
      }
      const events = this.llmManager.stream({
        modelKey: sceneRouteKey,
        modelKeyKind: "scene_route",
        messages: requestPlan.messages,
        temperature,
        maxTokens,
        ...(requestPlan.providerOptions
          ? { providerOptions: requestPlan.providerOptions }
          : {}),
        ...llmRequestContext,
      });
      switch (requestPlan.adapter) {
        case "kickoff":
          yield* adaptKickoffAiNovelStream({
            sceneRouteKey,
            events,
            normalizeToolCall: (toolCall, fallbackIndex) => ({
              ...toolCall,
              id: normalizeAiNovelToolCallId(
                toolCall.id,
                buildAiNovelFallbackToolCallId(
                  sceneRouteKey,
                  "kickoff",
                  fallbackIndex,
                ),
              ),
            }),
          });
          return;
        case "imported_kickoff":
          yield* adaptKickoffAiNovelStream({
            sceneRouteKey,
            events,
            normalizeToolCall: (toolCall, fallbackIndex) =>
              normalizeAiNovelPromptedToolCall(
                toolCall,
                sceneRouteKey,
                fallbackIndex,
              ),
          });
          return;
        case "prompted":
          yield* adaptPromptedAiNovelStream({
            sceneRouteKey,
            profile: requestPlan.profile,
            events,
            normalizeToolCall: (toolCall, fallbackIndex) =>
              normalizeAiNovelPromptedToolCall(
                toolCall,
                sceneRouteKey,
                fallbackIndex,
              ),
          });
          return;
        case "basic":
          yield* adaptBasicAiNovelStream({ sceneRouteKey, events });
          return;
        default:
          return assertNeverRequestPlan(requestPlan);
      }
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
        ...aiNovelUsageOwner(options),
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

function assertNeverRequestPlan(plan: never): never {
  throw new Error(
    `Unsupported AINovel stream request plan: ${String(
      (plan as { adapter?: unknown }).adapter,
    )}`,
  );
}
