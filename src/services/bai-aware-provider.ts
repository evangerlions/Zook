import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { BaiOpenAICompatibleProvider } from "./bai-openai-compatible-provider.ts";
import { createBaiTransparentProxyFetch } from "./bai-transparent-proxy.ts";

export function createBaiAwareProvider(
  commonLlmConfigService: CommonLlmConfigService,
  commonPasswordConfigService: CommonPasswordConfigService,
  logger: StructuredLogger,
): BaiOpenAICompatibleProvider {
  const fetchImplementation = createBaiTransparentProxyFetch({
    resolveConfig: async () => (await commonLlmConfigService.getCurrentConfig()).bai,
    resolveSecret: async (key) => commonPasswordConfigService.getValue(key),
    onProxyRequest: (details) => logger.info("routing B.AI request through transparent proxy", details),
  });
  return new BaiOpenAICompatibleProvider({ logger, fetchImplementation });
}
