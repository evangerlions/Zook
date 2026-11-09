import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { billingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import {
  createApplication as createRuntimeApplication,
  type CreateApplicationOptions,
} from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

export type { CreateApplicationOptions } from "../../src/app.module.ts";

export async function createApplication(options: CreateApplicationOptions = {}) {
  // Existing suites explicitly exercise the full historical feature set. Production
  // defaults are tested using the real factory in runtime-scope.api.test.ts.
  const testOptions = { ...options };
  if (options.lighttickEnabled) {
    testOptions.seed = structuredClone(options.seed ?? buildDefaultSeed(undefined, { includeLightTick: true }));
    const record = testOptions.seed.appConfigs.find(c => c.appId === "lighttick" && c.configKey === "admin.delivery_config");
    if (record) {
      const config = JSON.parse(record.configValue);
      if (config.settings?.runtimeScope === undefined) record.configValue = JSON.stringify({ ...config, settings: { ...config.settings, runtimeScope: "full" } });
    }
  }
  const runtime = await createRuntimeApplication({
    appEnvironment: "test",
    ...testOptions,
    databaseFactory: options.databaseFactory ?? ((seed) => new InMemoryDatabase(seed)),
  });
  const handle = runtime.app.handle.bind(runtime.app);
  // Older scoped fixtures inherit context only when the caller omitted the header.
  runtime.app.handle = request => handle({ ...request, headers:
    Object.keys(request.headers).some(key => key.toLowerCase() === "x-billing-environment") ? request.headers :
      { ...request.headers, "x-billing-environment": billingEnvironment() },
  });
  return runtime;
}
