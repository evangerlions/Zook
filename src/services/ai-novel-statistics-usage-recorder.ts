import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { LLMManagerOptions } from "./llm-manager.ts";
import type { AiNovelStatisticsService } from "./ai-novel-statistics.service.ts";

type UsageOptions = Pick<
  LLMManagerOptions,
  "usageRecorder" | "usageRecorderErrorHandler"
>;

export function createAiNovelStatisticsUsageOptions(
  statisticsService: AiNovelStatisticsService,
  logger: StructuredLogger,
): UsageOptions {
  return {
    usageRecorder: async ({ appId, userId, usage, occurredAt }) => {
      await statisticsService.recordTokenUsage({
        appId,
        userId,
        totalTokens: usage.totalTokens,
        occurredAt,
      });
    },
    usageRecorderErrorHandler: ({ appId, userId, occurredAt, error }) => {
      logger.warn("failed to record LLM usage for app statistics", {
        appId,
        userId,
        occurredAt: occurredAt.toISOString(),
        error,
      });
    },
  };
}
