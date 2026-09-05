import type { LlmMetricsService } from "../../services/llm-metrics.service.ts";
import type { LlmModelHealthService } from "../../services/llm-model-health.service.ts";
import type {
  AiNovelModelHealth,
  AiNovelModelSelectionConfig,
} from "../../shared/types.ts";
import { buildAiNovelEffectiveModelWeights } from "../ai-novel/ai-novel-model-weight-selection.ts";

export class AdminAiNovelModelHealthService {
  constructor(
    private readonly llmMetricsService: LlmMetricsService,
    private readonly llmModelHealthService: LlmModelHealthService,
  ) {}

  async getModelHealth(
    selection: AiNovelModelSelectionConfig,
  ): Promise<AiNovelModelHealth[]> {
    let requestCounts = new Map<string, number>();
    try {
      requestCounts = new Map(
        Object.entries(
          await this.llmMetricsService.getRoutingModelRequestCounts(
            "24h",
            new Date(),
            "chat",
            "ai_novel",
          ),
        ),
      );
    } catch {
      // Metrics are auxiliary to model configuration. Keep the page usable
      // when the historical-count query is temporarily unavailable.
    }
    const totalRequests = selection.chat.default.reduce(
      (sum, model) => sum + (requestCounts.get(model.modelKey) ?? 0),
      0,
    );
    const healthEntries = await Promise.all(
      selection.chat.default.map(async (model) => {
        try {
          return [
            model.modelKey,
            await this.llmModelHealthService.getModelHealth(model.modelKey),
          ] as const;
        } catch {
          return [
            model.modelKey,
            {
              modelKey: model.modelKey,
              available: false,
              healthScore: 0,
              sampleSize: 0,
            },
          ] as const;
        }
      }),
    );
    const healthByModelKey = new Map(healthEntries);
    const effectiveWeights = buildAiNovelEffectiveModelWeights(
      selection,
      healthByModelKey,
    );
    const effectiveWeightByModelKey = new Map(
      effectiveWeights.map((model) => [model.modelKey, model.effectiveWeight]),
    );
    return selection.chat.default.map((model) => {
      const health = healthByModelKey.get(model.modelKey);
      return {
        modelKey: model.modelKey,
        configuredWeight: model.weight,
        effectiveWeight: effectiveWeightByModelKey.get(model.modelKey) ?? 0,
        actualHitRate: totalRequests > 0
          ? Math.round(
              ((requestCounts.get(model.modelKey) ?? 0) / totalRequests) *
                10000,
            ) / 100
          : 0,
        healthScore: health?.healthScore ?? 0,
        sampleSize: health?.sampleSize ?? 0,
        available: health?.available ?? false,
        ...(health?.successRate === undefined ? {} : { successRate: health.successRate }),
        ...(health?.lastErrorAt ? { lastErrorAt: health.lastErrorAt } : {}),
      };
    });
  }
}
