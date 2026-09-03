import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { KVManager } from "./infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { AiNovelStatisticsService } from "./services/ai-novel-statistics.service.ts";
import { createAiNovelStatisticsUsageOptions } from "./services/ai-novel-statistics-usage-recorder.ts";
import {
  AliyunTokenPlanProvider,
  ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
} from "./services/aliyun-token-plan-provider.ts";
import { BailianOpenAICompatibleProvider } from "./services/bailian-openai-compatible-provider.ts";
import type { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import {
  EmbeddingManager,
  type EmbeddingProvider,
} from "./services/embedding-manager.ts";
import type { LlmHealthService } from "./services/llm-health.service.ts";
import type { LlmMetricsService } from "./services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "./services/llm-smoke-test.service.ts";
import {
  LocalAiNovelE2eProvider,
  shouldUseLocalAiNovelE2eProvider,
} from "./services/local-ainovel-e2e-provider.ts";
import { LLMManager, type LLMProvider } from "./services/llm-manager.ts";
import { createOpenRouterAwareProvider } from "./services/openrouter-aware-provider.ts";
import {
  VolcengineAgentPlanProvider,
  VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
} from "./services/volcengine-agent-plan-provider.ts";

interface ApplicationAiRuntimeOptions {
  database: ApplicationDatabase;
  commonLlmConfigService: CommonLlmConfigService;
  commonPasswordConfigService: CommonPasswordConfigService;
  llmHealthService: LlmHealthService;
  llmMetricsService: LlmMetricsService;
  kvManager: KVManager;
  logger: StructuredLogger;
  llmProviders?: Record<string, LLMProvider>;
  embeddingProviders?: Record<string, EmbeddingProvider>;
}

export function createApplicationAiRuntime(
  options: ApplicationAiRuntimeOptions,
) {
  const aiNovelStatisticsService = new AiNovelStatisticsService(
    options.database,
  );
  const bailianProvider = new BailianOpenAICompatibleProvider({
    logger: options.logger,
  });
  const aliyunTokenPlanProvider = new AliyunTokenPlanProvider({
    logger: options.logger,
  });
  const openRouterProvider = createOpenRouterAwareProvider(
    options.commonLlmConfigService,
    options.commonPasswordConfigService,
    options.logger,
  );
  const volcengineAgentPlanProvider = new VolcengineAgentPlanProvider({
    logger: options.logger,
  });
  const localAiNovelE2eProvider = shouldUseLocalAiNovelE2eProvider()
    ? new LocalAiNovelE2eProvider()
    : undefined;
  if (localAiNovelE2eProvider) {
    options.logger.info("using local AINovel E2E LLM provider", {
      appEnv: process.env.APP_ENV,
      nodeEnv: process.env.NODE_ENV,
    });
  }

  const llmProviders = options.llmProviders ?? {
    bailian: localAiNovelE2eProvider ?? bailianProvider,
    bailian_coding: localAiNovelE2eProvider ?? bailianProvider,
    [ALIYUN_TOKEN_PLAN_PROVIDER_KEY]:
      localAiNovelE2eProvider ?? aliyunTokenPlanProvider,
    openrouter: localAiNovelE2eProvider ?? openRouterProvider,
    [VOLCENGINE_AGENT_PLAN_PROVIDER_KEY]:
      localAiNovelE2eProvider ?? volcengineAgentPlanProvider,
  };
  const embeddingProviders = options.embeddingProviders ?? {
    bailian: localAiNovelE2eProvider ?? bailianProvider,
    bailian_coding: localAiNovelE2eProvider ?? bailianProvider,
    openrouter: localAiNovelE2eProvider ?? openRouterProvider,
  };
  const statisticsUsageOptions = createAiNovelStatisticsUsageOptions(
    aiNovelStatisticsService,
    options.logger,
  );
  const managerOptions = {
    commonLlmConfigService: options.commonLlmConfigService,
    llmHealthService: options.llmHealthService,
    llmMetricsService: options.llmMetricsService,
    ...statisticsUsageOptions,
  };

  return {
    aiNovelStatisticsService,
    embeddingManager: new EmbeddingManager(
      embeddingProviders,
      undefined,
      managerOptions,
    ),
    llmManager: new LLMManager(llmProviders, undefined, managerOptions),
    llmSmokeTestService: new LlmSmokeTestService(
      options.commonLlmConfigService,
      options.kvManager,
      llmProviders,
      embeddingProviders,
    ),
  };
}
