import { createApplication, type CreateApplicationOptions } from "../../app.module.ts";
import { KVManager } from "../kv/kv-manager.ts";
import {
  assertRuntimeDependenciesReady,
  resolveRuntimeRedisUrl,
} from "./runtime-readiness.ts";

type RuntimeServiceName = NonNullable<CreateApplicationOptions["serviceName"]>;

export interface RuntimeInitOptions extends CreateApplicationOptions {
  serviceName: RuntimeServiceName;
}

/**
 * init is the single startup entry for long-lived server processes.
 * It performs dependency checks first, then wires the runtime.
 */
export async function init(options: RuntimeInitOptions) {
  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() }));
  await assertRuntimeDependenciesReady(kvManager, options.serviceName);
  const runtime = await createApplication({
    ...options,
    kvManager,
  });
  return runtime;
}
