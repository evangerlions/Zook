import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { ManagedStateStore } from "./infrastructure/kv/managed-state.store.ts";
import { migrateAiNovelKickoffPromptConfig } from "./modules/ai-novel/ai-novel-kickoff-prompt-config-migration.ts";
import type { AppLogSecretService } from "./services/app-log-secret.service.ts";
import type { AppRemoteLogPullService } from "./services/app-remote-log-pull.service.ts";
import type { CommonGetuiGyConfigService } from "./services/common-getui-gy-config.service.ts";
import type { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import type { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";
import { importVolcengineAgentPlanConfig } from "./services/volcengine-agent-plan-config.ts";

interface ApplicationStartupConfigOptions {
  database: ApplicationDatabase;
  managedStateStore: ManagedStateStore;
  appConfigService: VersionedAppConfigService;
  appLogSecretService: AppLogSecretService;
  appRemoteLogPullService: AppRemoteLogPullService;
  commonGetuiGyConfigService: CommonGetuiGyConfigService;
  commonLlmConfigService: CommonLlmConfigService;
  commonPasswordConfigService: CommonPasswordConfigService;
}

export async function initializeApplicationConfigs(
  options: ApplicationStartupConfigOptions,
): Promise<void> {
  await options.database.withExclusiveSession(async () => {
    const initializedCommonLlmConfig =
      await options.commonLlmConfigService.initializeDefaultConfig();
    const importedVolcengineAgentPlan =
      await importVolcengineAgentPlanConfig(
        options.commonLlmConfigService,
        options.commonPasswordConfigService,
      );
    const initializedAppLogSecrets =
      await options.appLogSecretService.initializeSecrets(
        await options.database.listAppIds(),
      );
    const initializedRemoteLogPullConfigs =
      await options.appRemoteLogPullService.initializeMissingConfigs(
        await options.database.listAppIds(),
      );
    const initializedGetuiGyConfig =
      await options.commonGetuiGyConfigService.initializeDefaultConfig();
    const migratedAiNovelKickoffPrompts =
      await migrateAiNovelKickoffPromptConfig(options.appConfigService);

    if (
      initializedCommonLlmConfig ||
      importedVolcengineAgentPlan ||
      initializedAppLogSecrets ||
      initializedRemoteLogPullConfigs ||
      initializedGetuiGyConfig ||
      migratedAiNovelKickoffPrompts
    ) {
      await options.managedStateStore.save(options.database);
    }
  });
}
