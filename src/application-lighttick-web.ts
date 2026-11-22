import { attachLightTickParticipation } from "./application-lighttick-participation.ts";
import { attachLightTickBackups } from "./application-lighttick-backups.ts";
import { LightTickCommerceService } from "./modules/lighttick/billing/commerce.service.ts";
import { billingPolicy } from "./modules/lighttick/billing/commerce-policy.ts";
import { aiNovelAlipayRuntimeOptions } from "./modules/billing/ainovel-payment-config.ts";
import type { LightTickRuntime } from "./modules/lighttick/lighttick-runtime.ts";
import type { LightTickRepository } from "./modules/lighttick/lighttick.repository.ts";
import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { CommonTestAccountService } from "./services/common-test-account.service.ts";
import type { StorageService } from "./infrastructure/files/storage.service.ts";
import type { PersistentFileStore } from "./infrastructure/files/persistent-file-store.ts";
import type { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";
import type { LightTickAlipayOptions } from "./modules/lighttick/billing/commerce.service.ts";
import { billingDeploymentEnvironment } from "./modules/billing/billing-environment.ts";

export function attachLightTickWebServices(input: {
  runtime?: LightTickRuntime;
  repository: LightTickRepository;
  database: ApplicationDatabase;
  tests: CommonTestAccountService;
  storage: StorageService;
  files: PersistentFileStore;
  secrets: string[];
  models: VersionedAppConfigService;
  alipay?: LightTickAlipayOptions;
  deployment?: string;
}) {
  const { runtime, repository, database, secrets } = input;
  if (!runtime) return;
  attachLightTickParticipation(runtime, database, input.tests, secrets);
  attachLightTickBackups(runtime, secrets, input.storage, input.files);
  const readConfig = async () => {
    const config = await input.models.getValue("lighttick", "admin.delivery_config");
    return config ? JSON.parse(config) : {};
  };
  const merchantOptions = Object.fromEntries(Object.entries(aiNovelAlipayRuntimeOptions()).map(
    ([environment, option]) => [environment, { ...option, returnUrl: undefined,
      notifyUrl: option.notifyUrl?.replace("/ai_novel/", "/lighttick/") }],
  ));
  runtime.commerce = new LightTickCommerceService(repository, readConfig,
    input.alipay ?? merchantOptions, async id => {
      const [membership, account] = await Promise.all([database.findAppUser("lighttick", id), database.findUserById(id)]);
      return membership?.status === "ACTIVE" && account?.status === "ACTIVE";
    }, () => new Date(), () => runtime.scopePolicy.assertFull());
  runtime.billingDeployment = input.deployment ?? billingDeploymentEnvironment();
  repository.configureStorageQuota(async () => billingPolicy(await readConfig()));
}
