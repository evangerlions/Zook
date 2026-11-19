import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import type { VersionedAppConfigService } from "../../../services/versioned-app-config.service.ts";
import type { SecretReferenceResolver } from "../../../services/secret-reference-resolver.ts";
import type { CommonContentSafetyConfigService } from "../../../services/common-content-safety-config.service.ts";
import type { ContentSafetyService } from "../../../services/content-safety.service.ts";
import type { AiNovelCreditsService } from "../credits/ai-novel-credits.service.ts";
import { SearchConfigService } from "./search-config.ts";
import { SearchUsage } from "./search-usage.ts";
import { WebSearchService } from "./web-search.service.ts";

export function createWebSearchService(deps: {
  appConfigService: VersionedAppConfigService; secrets: SecretReferenceResolver; kv: KVManager;
  credits: AiNovelCreditsService; safety: ContentSafetyService; safetyConfig: CommonContentSafetyConfigService; logger: StructuredLogger;
}) {
  return new WebSearchService(new SearchConfigService(deps.appConfigService, deps.secrets), new SearchUsage(deps.kv), deps.credits,
    deps.safety, async (length = 0) => {
      const config = await deps.safetyConfig.getCurrentConfig();
      return config.enabled && (length > config.longTextThresholdChars ? config.aliyun.enabled : config.llm.enabled);
    }, undefined, deps.logger);
}
