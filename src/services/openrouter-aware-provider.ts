import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { createOpenRouterTransparentProxyFetch } from "./openrouter-transparent-proxy.ts";

export function createOpenRouterAwareProvider(
  commonLlmConfigService: CommonLlmConfigService,
  commonPasswordConfigService: CommonPasswordConfigService,
  logger: StructuredLogger,
): BailianOpenAICompatibleProvider {
  const fetchImplementation = createOpenRouterTransparentProxyFetch({
    resolveConfig: async () => (await commonLlmConfigService.getCurrentConfig()).openRouter,
    resolveSecret: async (key) => commonPasswordConfigService.getValue(key),
    onProxyRequest: (details) => {
      logger.info("routing OpenRouter request through transparent proxy", details);
    },
  });
  return new BailianOpenAICompatibleProvider({ logger, fetchImplementation });
}
