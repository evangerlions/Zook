import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import type { CreateApplicationOptions } from "./application-options.ts";
import { AINOVEL_PAYMENT_IDENTITIES, aiNovelAlipayRuntimeOptions } from "./modules/billing/ainovel-payment-config.ts";
import { readAiNovelAlipayPrices } from "./modules/billing/ainovel-alipay-pricing.ts";
import { billingSandboxAllowed } from "./modules/billing/billing-environment.ts";
import { AiNovelBillingService } from "./services/ainovel-billing.service.ts";
import type { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";

export function createApplicationBillingService(database: ApplicationDatabase, config: VersionedAppConfigService,
  options: CreateApplicationOptions, logger: StructuredLogger): AiNovelBillingService {
  const identity = AINOVEL_PAYMENT_IDENTITIES.revenueCat;
  const allowSandbox = options.billingEnvironment?.allowSandbox ?? billingSandboxAllowed();
  return new AiNovelBillingService(database, {
    alipay: { ...(options.alipay ?? aiNovelAlipayRuntimeOptions()), allowSandbox },
    readAlipayPrices: () => readAiNovelAlipayPrices(config),
    secretApiKey: options.revenueCat?.secretApiKey ?? process.env.REVENUECAT_AI_NOVEL_SECRET_API_KEY,
    revenueCatProjectId: options.revenueCat?.projectId ?? identity.projectId,
    revenueCatAppId: options.revenueCat?.appId ?? identity.appleAppId,
    revenueCatGoogleAppId: options.revenueCat?.googleAppId ?? identity.googleAppId,
    webhookAuthorization: options.revenueCat?.webhookAuthorization ?? process.env.REVENUECAT_AI_NOVEL_WEBHOOK_AUTHORIZATION,
    allowSandbox: allowSandbox && (options.revenueCat?.allowSandbox ?? true),
    fetcher: options.revenueCat?.fetcher, timeoutMs: options.revenueCat?.timeoutMs, now: options.revenueCat?.now,
  }, logger);
}
