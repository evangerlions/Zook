import { createApplication, type CreateApplicationOptions } from "../../app.module.ts";
import { assertRuntimeDependenciesReady } from "./runtime-readiness.ts";

type RuntimeServiceName = NonNullable<CreateApplicationOptions["serviceName"]>;

export interface RuntimeInitOptions extends CreateApplicationOptions {
  serviceName: RuntimeServiceName;
}

/**
 * init is the single startup entry for long-lived server processes.
 * It performs dependency checks first, then wires the runtime.
 */
export async function init(options: RuntimeInitOptions) {
  const runtime = await createApplication(options);
  await assertRuntimeDependenciesReady(runtime.services.kvManager, options.serviceName);
  return runtime;
}
