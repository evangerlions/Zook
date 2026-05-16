import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { ApplicationError, tooManyRequests } from "../shared/errors.ts";
import type {
  AdminLlmSmokeTestDetails,
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestErrorPayload,
  AdminLlmSmokeTestItem,
  AdminLlmSmokeTestRequestPayload,
  AdminLlmSmokeTestResponsePayload,
  AdminLlmSmokeTestSkipPayload,
  AdminLlmSmokeTestSummary,
  LlmModelConfig,
  LlmProviderConfig,
  LlmServiceConfig,
} from "../shared/types.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { EmbeddingProvider, EmbeddingResult, ResolvedEmbeddingRequest } from "./embedding-manager.ts";
import type { LLMProvider, ResolvedLLMCompletionRequest } from "./llm-manager.ts";

const SMOKE_TEST_SCOPE = "admin-llm-smoke-test";
const SMOKE_TEST_COOLDOWN_KEY = "cooldown";
const DEFAULT_COOLDOWN_MS = 10_000;
const RESPONSE_PREVIEW_LIMIT = 120;
const ERROR_STACK_PREVIEW_LIMIT = 6;
const VECTOR_PREVIEW_LIMIT = 8;
const SMOKE_MESSAGES = [
  {
    role: "system" as const,
    content: "You are a smoke test assistant. Reply with OK only.",
  },
  {
    role: "user" as const,
    content: "Please reply with OK.",
  },
];
const SMOKE_EMBEDDING_INPUT = [
  "Smoke test embedding text.",
];

export interface LlmSmokeTestServiceOptions {
  now?: () => Date;
  cooldownMs?: number;
}

interface SmokeMatrixItem {
  model: LlmModelConfig;
  provider: LlmProviderConfig;
  route?: LlmServiceConfig["models"][number]["routes"][number];
}

export class LlmSmokeTestService {
  constructor(
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly kvManager: KVManager,
    private readonly chatProviders: Record<string, LLMProvider>,
    private readonly embeddingProviders: Record<string, EmbeddingProvider>,
    private readonly options: LlmSmokeTestServiceOptions = {},
  ) {}

  async run(): Promise<AdminLlmSmokeTestDocument> {
    await this.assertCooldown();

    const config = await this.commonLlmConfigService.getRuntimeConfig();
    if (!config?.enabled) {
      throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "LLM 服务未启用，无法执行冒烟测试。");
    }

    const items = await Promise.all(
      this.buildMatrix(config).map((item) => this.runItem(item)),
    );
    const executedAt = this.getNow().toISOString();

    return {
      executedAt,
      cooldownSeconds: Math.ceil(this.getCooldownMs() / 1000),
      summary: this.buildSummary(items),
      items,
    };
  }

  private async assertCooldown(): Promise<void> {
    const now = this.getNow().getTime();
    const previous = await this.kvManager.getString(SMOKE_TEST_SCOPE, SMOKE_TEST_COOLDOWN_KEY);
    const previousMs = previous ? Number(previous) : 0;
    const cooldownMs = this.getCooldownMs();

    if (Number.isFinite(previousMs) && previousMs > 0 && now - previousMs < cooldownMs) {
      const retryAfterMs = cooldownMs - (now - previousMs);
      tooManyRequests(
        "ADMIN_RATE_LIMITED",
        `LLM 冒烟测试 10 秒内只能触发一次，请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试。`,
        {
          retryAfterMs,
        },
      );
    }

    await this.kvManager.setString(SMOKE_TEST_SCOPE, SMOKE_TEST_COOLDOWN_KEY, String(now));
  }

  private buildMatrix(config: LlmServiceConfig): SmokeMatrixItem[] {
    return config.models.flatMap((model) =>
      config.providers.map((provider) => ({
        model,
        provider,
        route: model.routes.find((route) => route.provider === provider.key),
      })),
    );
  }

  private async runItem(item: SmokeMatrixItem): Promise<AdminLlmSmokeTestItem> {
    const base: Omit<AdminLlmSmokeTestItem, "status" | "message"> = {
      modelKind: item.model.kind,
      modelKey: item.model.key,
      modelLabel: item.model.label,
      provider: item.provider.key,
      providerLabel: item.provider.label,
      providerModel: item.route?.providerModel ?? "",
      configured: Boolean(item.route),
      details: {},
    };

    if (!item.route) {
      return {
        ...base,
        status: "skipped",
        message: "当前模型没有配置该供应商 route。",
        details: {
          skip: this.buildSkipDetails("当前模型没有配置该供应商 route。", item, false),
        },
      };
    }

    const requestDetails = this.buildRequestDetails(item);

    if (!item.provider.enabled) {
      return {
        ...base,
        status: "skipped",
        message: "该供应商已禁用，未发起测试请求。",
        details: {
          request: requestDetails,
          skip: this.buildSkipDetails("该供应商已禁用，未发起测试请求。", item, true),
        },
      };
    }

    if (!item.route.enabled) {
      return {
        ...base,
        status: "skipped",
        message: "该 route 已禁用，未发起测试请求。",
        details: {
          request: requestDetails,
          skip: this.buildSkipDetails("该 route 已禁用，未发起测试请求。", item, true),
        },
      };
    }

    const startedAt = this.getNow().getTime();

    try {
      if (item.model.kind === "embedding") {
        const provider = this.embeddingProviders[item.provider.key];
        if (!provider) {
          return {
            ...base,
            status: "failed",
            message: "当前运行时还没有接入这个 embedding 供应商适配器。",
            details: {
              request: requestDetails,
              error: this.buildErrorDetails(
                new ApplicationError(
                  503,
                  "LLM_ROUTE_NOT_AVAILABLE",
                  "当前运行时还没有接入这个 embedding 供应商适配器。",
                  {
                    provider: item.provider.key,
                    kind: "embedding",
                  },
                ),
              ),
            },
          };
        }

        const request = this.buildEmbeddingRequest(item);
        const response = await provider.embed(request);
        const latencyMs = this.getNow().getTime() - startedAt;

        return {
          ...base,
          status: "success",
          latencyMs,
          message: "Embedding 请求成功，供应商返回了有效向量。",
          responsePreview: truncateText(
            `${response.vectors.length} vectors · dim ${response.vectors[0]?.embedding.length ?? 0}`,
            RESPONSE_PREVIEW_LIMIT,
          ),
          details: {
            request: requestDetails,
            response: this.buildEmbeddingResponseDetails(response),
          },
        };
      }

      const provider = this.chatProviders[item.provider.key];
      if (!provider) {
        return {
          ...base,
          status: "failed",
          message: "当前运行时还没有接入这个供应商适配器。",
          details: {
            request: requestDetails,
            error: this.buildErrorDetails(
              new ApplicationError(
                503,
                "LLM_ROUTE_NOT_AVAILABLE",
                "当前运行时还没有接入这个供应商适配器。",
                {
                  provider: item.provider.key,
                  kind: "chat",
                },
              ),
            ),
          },
        };
      }

      const request = this.buildChatRequest(item);
      const response = await provider.complete(request);
      const latencyMs = this.getNow().getTime() - startedAt;

      return {
        ...base,
        status: "success",
        latencyMs,
        message: "请求成功，供应商返回了有效响应。",
        responsePreview: truncateText(response.text || response.reasoningText || "", RESPONSE_PREVIEW_LIMIT),
        details: {
          request: requestDetails,
          response: this.buildChatResponseDetails(response),
        },
      };
    } catch (error) {
      const latencyMs = this.getNow().getTime() - startedAt;
      return {
        ...base,
        status: "failed",
        latencyMs,
        message: error instanceof Error ? error.message : "请求失败，未拿到有效响应。",
        details: {
          request: requestDetails,
          error: this.buildErrorDetails(error),
        },
      };
    }
  }

  private buildChatRequest(item: SmokeMatrixItem): ResolvedLLMCompletionRequest {
    const route = item.route;
    if (!route) {
      throw new Error("Smoke test route is missing.");
    }

    return {
      temperature: 0,
      maxTokens: 24,
      messages: SMOKE_MESSAGES,
      providerOptions: {},
      model: {
        provider: item.provider.key,
        modelKey: item.model.key,
        providerModel: route.providerModel,
        providerConfig: {
          baseUrl: item.provider.baseUrl,
          apiKey: item.provider.apiKey,
          timeoutMs: item.provider.timeoutMs,
        },
      },
    };
  }

  private buildEmbeddingRequest(item: SmokeMatrixItem): ResolvedEmbeddingRequest {
    const route = item.route;
    if (!route) {
      throw new Error("Smoke test route is missing.");
    }

    return {
      input: SMOKE_EMBEDDING_INPUT,
      providerOptions: {},
      model: {
        provider: item.provider.key,
        modelKey: item.model.key,
        providerModel: route.providerModel,
        providerConfig: {
          baseUrl: item.provider.baseUrl,
          apiKey: item.provider.apiKey,
          timeoutMs: item.provider.timeoutMs,
        },
      },
    };
  }

  private buildSummary(items: AdminLlmSmokeTestItem[]): AdminLlmSmokeTestSummary {
    const summary = items.reduce<AdminLlmSmokeTestSummary>(
      (acc, item) => {
        acc.totalCount += 1;
        if (item.status === "success") {
          acc.attemptedCount += 1;
          acc.successCount += 1;
        } else if (item.status === "failed") {
          acc.attemptedCount += 1;
          acc.failureCount += 1;
        } else {
          acc.skippedCount += 1;
        }
        return acc;
      },
      {
        totalCount: 0,
        attemptedCount: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        successRate: 0,
      },
    );

    summary.successRate = summary.attemptedCount
      ? roundTwoDecimals((summary.successCount / summary.attemptedCount) * 100)
      : 0;

    return summary;
  }

  private getCooldownMs(): number {
    return this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private buildRequestDetails(item: SmokeMatrixItem): AdminLlmSmokeTestRequestPayload | undefined {
    if (!item.route) {
      return undefined;
    }

    return item.model.kind === "embedding"
      ? {
          modelKind: "embedding",
          provider: item.provider.key,
          modelKey: item.model.key,
          providerModel: item.route.providerModel,
          baseUrl: item.provider.baseUrl,
          timeoutMs: item.provider.timeoutMs,
          input: [...SMOKE_EMBEDDING_INPUT],
          providerOptions: {},
        }
      : {
          modelKind: "chat",
          provider: item.provider.key,
          modelKey: item.model.key,
          providerModel: item.route.providerModel,
          baseUrl: item.provider.baseUrl,
          timeoutMs: item.provider.timeoutMs,
          messages: SMOKE_MESSAGES.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          temperature: 0,
          maxTokens: 24,
          providerOptions: {},
        };
  }

  private buildChatResponseDetails(response: Awaited<ReturnType<LLMProvider["complete"]>>): AdminLlmSmokeTestResponsePayload {
    return {
      modelKind: "chat",
      provider: response.provider,
      modelKey: response.modelKey,
      providerModel: response.providerModel,
      text: response.text,
      ...(response.reasoningText ? { reasoningText: response.reasoningText } : {}),
      ...(response.finishReason ? { finishReason: response.finishReason } : {}),
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }

  private buildEmbeddingResponseDetails(response: EmbeddingResult): AdminLlmSmokeTestResponsePayload {
    const firstVector = response.vectors[0];
    return {
      modelKind: "embedding",
      provider: response.provider,
      modelKey: response.modelKey,
      providerModel: response.providerModel,
      vectorCount: response.vectors.length,
      ...(firstVector ? { dimensions: firstVector.embedding.length } : {}),
      ...(firstVector
        ? {
            vectorPreview: [
              {
                index: firstVector.index,
                embedding: firstVector.embedding.slice(0, VECTOR_PREVIEW_LIMIT),
              },
            ],
          }
        : {}),
      ...(response.providerRequestId ? { providerRequestId: response.providerRequestId } : {}),
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }

  private buildErrorDetails(error: unknown): AdminLlmSmokeTestErrorPayload {
    if (error instanceof ApplicationError) {
      return {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        ...(error.details === undefined ? {} : { details: toJsonSafeValue(error.details) }),
        ...(error.stack ? { stackPreview: truncateStack(error.stack) } : {}),
      };
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        ...(error.stack ? { stackPreview: truncateStack(error.stack) } : {}),
      };
    }

    return {
      name: "UnknownError",
      message: String(error ?? "Unknown smoke test error."),
    };
  }

  private buildSkipDetails(reason: string, item: SmokeMatrixItem, configured: boolean): AdminLlmSmokeTestSkipPayload {
    return {
      reason,
      configured,
      providerEnabled: item.provider.enabled,
      ...(item.route ? { routeEnabled: item.route.enabled } : {}),
    };
  }
}

function truncateText(value: string, limit: number): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function truncateStack(stack: string): string[] {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ERROR_STACK_PREVIEW_LIMIT);
}

function toJsonSafeValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafeValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonSafeValue(item)]),
    );
  }

  return String(value);
}
