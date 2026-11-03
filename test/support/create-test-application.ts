import { billingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import {
  createApplication as createRuntimeApplication,
  type CreateApplicationOptions,
} from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

export type { CreateApplicationOptions } from "../../src/app.module.ts";

export async function createApplication(options: CreateApplicationOptions = {}) {
  const runtime = await createRuntimeApplication({
    appEnvironment: "test",
    ...options,
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
