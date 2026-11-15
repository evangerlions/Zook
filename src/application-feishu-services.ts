import { billingProviderOptions } from "./modules/billing-accounts/provider-links.ts";
import { llmQueryCredential, removeCopiedLlmCredentials } from "./modules/billing-accounts/llm-query-credential.ts";
import { ManualLoginSessions } from "./modules/billing-accounts/manual/login-sessions.ts";
import { SessionVault } from "./modules/billing-accounts/manual/session-vault.ts";
import { accountMigration } from "./modules/billing-accounts/account-migration.ts";
import { ApplicationError } from "./shared/errors.ts";
import { AccountStore } from "./modules/billing-accounts/account-store.ts";
import { AccountMonitor } from "./modules/billing-accounts/account-monitor.ts";
import type { KVManager } from "./infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import type { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import type { SecretReferenceResolver } from "./services/secret-reference-resolver.ts";
import type { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";
import { FeishuClient } from "./modules/feishu/feishu-client.ts";
import { FeishuBookkeeping } from "./modules/feishu/bookkeeping.ts";
import { IntegrationAccess } from "./modules/feishu/integration-access.ts";
import { IntegrationReceipts } from "./modules/feishu/integration-receipts.ts";
import { BalanceConfigStore } from "./modules/llm-balances/balance-config.ts";
import { BalanceAlerts } from "./modules/llm-balances/balance-alerts.ts";
import { createOpenRouterTransparentProxyFetch } from "./services/openrouter-transparent-proxy.ts";
import { createBaiTransparentProxyFetch } from "./services/bai-transparent-proxy.ts";

export function createFeishuServices(kv: KVManager, passwords: CommonPasswordConfigService,
  configs: VersionedAppConfigService, llm: CommonLlmConfigService, resolver: SecretReferenceResolver,
  logger: StructuredLogger, fetcher: typeof fetch = fetch, encryptionSecrets: string[] = []) {
  const client = new FeishuClient(kv, passwords, fetcher);
  const receipts = new IntegrationReceipts(kv);
  const access = new IntegrationAccess(kv, passwords);
  const bookkeeping = new FeishuBookkeeping(client);
  const balanceConfig = new BalanceConfigStore(configs);
  const balanceAlerts = new BalanceAlerts(kv, client, receipts, logger);
  const openRouterFetch = createOpenRouterTransparentProxyFetch({ resolveConfig: async () => (await llm.getCurrentConfig()).openRouter,
    resolveSecret: key => passwords.getValue(key), fetchImplementation: fetcher });
  const balanceFetch = createBaiTransparentProxyFetch({ resolveConfig: async () => (await llm.getCurrentConfig()).bai,
    resolveSecret: key => passwords.getValue(key), fetchImplementation: openRouterFetch });
  const providerOptions = async () => billingProviderOptions((await llm.getCurrentConfig()).providers);
  const store = new AccountStore(kv, encryptionSecrets, async (keys, type) => {
    const providers = await providerOptions();
    if (keys.some(key => !providers.some(p => p.key === key && p.accountType === type))) throw new ApplicationError(400, "REQ_INVALID_BODY", "Provider does not match this billing account type.");
  });
  const migrate = accountMigration(kv, store, balanceConfig, llm, passwords, encryptionSecrets.length > 0);
  const accounts = new AccountMonitor(store, kv, balanceConfig, balanceAlerts, balanceFetch,
    async () => { await migrate(); await removeCopiedLlmCredentials(store); }, llmQueryCredential(store, llm, resolver), providerOptions);
  const manualLogins = new ManualLoginSessions(kv, store, accounts, new SessionVault(kv, encryptionSecrets), undefined, () => logger.error("Manual billing login cleanup failed", { jobName: "billing-manual-login" }));
  return { manualLogins, accounts, client, receipts, access, bookkeeping, balanceConfig, logger };
}
export type FeishuServices = ReturnType<typeof createFeishuServices>;
