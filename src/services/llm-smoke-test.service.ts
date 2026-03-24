import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { ApplicationError, tooManyRequests } from "../shared/errors.ts";
import type {
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestItem,
  AdminLlmSmokeTestSummary,
  LlmProviderConfig,
  LlmServiceConfig,
} from "../shared/types.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LLMProvider, ResolvedLLMCompletionRequest } from "./llm-manager.ts";

const SMOKE_TEST_SCOPE = "admin-llm-smoke-test";
const SMOKE_TEST_COOLDOWN_KEY = "cooldown";
const DEFAULT_COOLDOWN_MS = 10_000;
const RESPONSE_PREVIEW_LIMIT = 120;
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

export interface LlmSmokeTestServiceOptions {
  now?: () => Date;
  cooldownMs?: number;
}

interface SmokeMatrixItem {
  modelKey: string;
  modelLabel: string;
  provider: LlmProviderConfig;
  route?: LlmServiceConfig["models"][number]["routes"][number];
}

export class LlmSmokeTestService {
  constructor(
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly kvManager: KVManager,
    private readonly providers: Record<string, LLMProvider>,
    private readonly options: LlmSmokeTestServiceOptions = {},
  ) {}

  async run(): Promise<AdminLlmSmokeTestDocument> {
    await this.assertCooldown();

    const config = this.commonLlmConfigService.getCurrentConfig();
    if (!config.enabled) {
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
        modelKey: model.key,
        modelLabel: model.label,
        provider,
        route: model.routes.find((route) => route.provider === provider.key),
      })),
    );
  }

  private async runItem(item: SmokeMatrixItem): Promise<AdminLlmSmokeTestItem> {
    const base: Omit<AdminLlmSmokeTestItem, "status" | "message"> = {
      modelKey: item.modelKey,
      modelLabel: item.modelLabel,
      provider: item.provider.key,
      providerLabel: item.provider.label,
      providerModel: item.route?.providerModel ?? "",
      configured: Boolean(item.route),
    };

    if (!item.route) {
      return {
        ...base,
        status: "skipped",
        message: "当前模型没有配置该供应商 route。",
      };
    }

    if (!item.provider.enabled) {
      return {
        ...base,
        status: "skipped",
        message: "该供应商已禁用，未发起测试请求。",
      };
    }

    if (!item.route.enabled) {
      return {
        ...base,
        status: "skipped",
        message: "该 route 已禁用，未发起测试请求。",
      };
    }

    const provider = this.providers[item.provider.key];
    if (!provider) {
      return {
        ...base,
        status: "failed",
        message: "当前运行时还没有接入这个供应商适配器。",
      };
    }

    const startedAt = this.getNow().getTime();

    try {
      const response = await provider.complete(this.buildRequest(item));
      const latencyMs = this.getNow().getTime() - startedAt;

      return {
        ...base,
        status: "success",
        latencyMs,
        message: "请求成功，供应商返回了有效响应。",
        responsePreview: truncateText(response.text || response.reasoningText || "", RESPONSE_PREVIEW_LIMIT),
      };
    } catch (error) {
      const latencyMs = this.getNow().getTime() - startedAt;
      return {
        ...base,
        status: "failed",
        latencyMs,
        message: error instanceof Error ? error.message : "请求失败，未拿到有效响应。",
      };
    }
  }

  private buildRequest(item: SmokeMatrixItem): ResolvedLLMCompletionRequest {
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
        modelKey: item.modelKey,
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
