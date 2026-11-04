import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import type { CreateApplicationOptions } from "./application-options.ts";
import { AINOVEL_PAYMENT_IDENTITIES, aiNovelAlipayRuntimeOptions } from "./modules/billing/ainovel-payment-config.ts";
import { readAiNovelAlipayPrices } from "./modules/billing/ainovel-alipay-pricing.ts";
import { billingDeploymentEnvironment } from "./modules/billing/billing-environment.ts";
import { appleSandboxUserIds } from "./modules/billing/apple-sandbox-access.ts";
import { AiNovelBillingService } from "./services/ainovel-billing.service.ts";
import type { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";

export function createApplicationBillingService(database: ApplicationDatabase, config: VersionedAppConfigService,
  options: CreateApplicationOptions, logger: StructuredLogger): AiNovelBillingService {
  const identity = AINOVEL_PAYMENT_IDENTITIES.revenueCat;
  const appEnvironment = options.appEnvironment ?? billingDeploymentEnvironment();
  return new AiNovelBillingService(database, {
    appEnvironment,
    alipay: options.alipay ?? aiNovelAlipayRuntimeOptions({ ...process.env, APP_ENV: appEnvironment, DEPLOY_SLOT: appEnvironment }),
    readAlipayPrices: () => readAiNovelAlipayPrices(config),
    readAppleSandboxUserIds: async () => appleSandboxUserIds(JSON.parse(
      await config.getValue("ai_novel", "admin.delivery_config") ?? "{}")),
    secretApiKey: options.revenueCat?.secretApiKey ?? process.env.REVENUECAT_AI_NOVEL_SECRET_API_KEY,
    revenueCatProjectId: options.revenueCat?.projectId ?? identity.projectId,
    revenueCatAppId: options.revenueCat?.appId ?? identity.appleAppId,
    revenueCatGoogleAppId: options.revenueCat?.googleAppId ?? identity.googleAppId,
    webhookAuthorization: options.revenueCat?.webhookAuthorization ?? process.env.REVENUECAT_AI_NOVEL_WEBHOOK_AUTHORIZATION,
    fetcher: options.revenueCat?.fetcher, timeoutMs: options.revenueCat?.timeoutMs, now: options.revenueCat?.now,
  }, logger);
}
