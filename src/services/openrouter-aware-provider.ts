import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { OpenRouterOpenAICompatibleProvider } from "./openrouter-openai-compatible-provider.ts";
import { createOpenRouterTransparentProxyFetch } from "./openrouter-transparent-proxy.ts";

export function createOpenRouterAwareProvider(
  commonLlmConfigService: CommonLlmConfigService,
  commonPasswordConfigService: CommonPasswordConfigService,
  logger: StructuredLogger,
): OpenRouterOpenAICompatibleProvider {
  const fetchImplementation = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => (await commonLlmConfigService.getCurrentConfig()).openRouter,
    resolveSecret: async (key) => commonPasswordConfigService.getValue(key),
    onProxyRequest: (details) => {
      logger.info("routing OpenRouter request through transparent proxy", details);
    },
  });
  return new OpenRouterOpenAICompatibleProvider({ logger, fetchImplementation });
}
