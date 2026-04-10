import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type { LLMMessage, LLMManager } from "../../services/llm-manager.ts";
import type { EmbeddingManager, EmbeddingVector } from "../../services/embedding-manager.ts";
import { AppAiRoutingConfigService, AI_NOVEL_APP_ID } from "../../services/app-ai-routing-config.service.ts";
import { resolveAiNovelChatScene, resolveAiNovelEmbeddingScene } from "./ai-novel-llm-scenes.ts";

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

  async createChatCompletion(body: Record<string, unknown>): Promise<AiNovelChatResponse> {
    if (body.model !== undefined) {
      badRequest("REQ_INVALID_BODY", "model is not allowed. Use taskType to select the server-side scene.");
    }

    const taskType = this.requireTaskType(body);
    const scene = resolveAiNovelChatScene(taskType);
    const modelKey = await this.appAiRoutingConfigService.resolveModelKey(AI_NOVEL_APP_ID, "chat", scene.taskType, "free");
    const messages = this.normalizeMessages(body.messages);
    const temperature = this.optionalNumber(body.temperature, "temperature") ?? scene.defaultTemperature;
    const maxTokens = this.optionalPositiveInteger(body.maxTokens, "maxTokens") ?? scene.defaultMaxTokens;

    try {
      const result = await this.llmManager.complete({
        modelKey,
        messages,
        temperature,
        maxTokens,
      });

      return {
        taskType: scene.taskType,
        completion: {
          modelKey: result.modelKey,
          provider: result.provider,
          providerModel: result.providerModel,
          content: result.text,
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
        },
      };
    } catch (error) {
      throw this.mapUpstreamError(error);
    }
  }

  async createEmbeddings(body: Record<string, unknown>): Promise<AiNovelEmbeddingsResponse> {
    if (body.model !== undefined) {
      badRequest("REQ_INVALID_BODY", "model is not allowed. Use taskType to select the server-side scene.");
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
        ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
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
      badRequest("REQ_INVALID_BODY", "messages must contain at least one item.");
    }

    return value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("REQ_INVALID_BODY", "Each message must be a JSON object.");
      }

      const role = (item as Record<string, unknown>).role;
      const content = (item as Record<string, unknown>).content;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        badRequest("REQ_INVALID_BODY", `Unsupported LLM role: ${String(role)}.`);
      }

      if (typeof content !== "string" || !content.trim()) {
        badRequest("REQ_INVALID_BODY", "Each message content must be a non-empty string.");
      }

      return {
        role,
        content: content.trim(),
      };
    });
  }

  private normalizeEmbeddingInput(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      badRequest("AI_EMBEDDING_INPUT_INVALID", "input must be a non-empty string array.");
    }

    return value.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        badRequest("AI_EMBEDDING_INPUT_INVALID", "input must contain non-empty strings only.");
      }
      return item.trim();
    });
  }

  private optionalNumber(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "number" || Number.isNaN(value)) {
      badRequest("REQ_INVALID_BODY", `${fieldName} must be a number when provided.`);
    }

    return value;
  }

  private optionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (typeof value !== "number" || Number.isNaN(value) || value <= 0 || !Number.isInteger(value)) {
      badRequest("REQ_INVALID_BODY", `${fieldName} must be a positive integer when provided.`);
    }

    return value;
  }

  private mapUpstreamError(error: unknown): unknown {
    if (!(error instanceof ApplicationError)) {
      return error;
    }

    if (error.code === "LLM_PROVIDER_REQUEST_FAILED") {
      if (error.statusCode === 504 || getDetailString(error.details, "reason") === "timeout") {
        return new ApplicationError(504, "AI_UPSTREAM_TIMEOUT", "Upstream model service timed out.", error.details);
      }

      return new ApplicationError(502, "AI_UPSTREAM_BAD_GATEWAY", error.message, error.details);
    }

    if (
      error.code === "LLM_PROVIDER_RESPONSE_INVALID" ||
      error.code === "LLM_ROUTE_NOT_AVAILABLE" ||
      error.code === "LLM_SERVICE_NOT_CONFIGURED" ||
      error.code === "LLM_MODEL_NOT_FOUND"
    ) {
      return new ApplicationError(502, "AI_UPSTREAM_BAD_GATEWAY", error.message, error.details);
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
