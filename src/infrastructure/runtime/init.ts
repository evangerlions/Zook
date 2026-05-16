import { createApplication, type CreateApplicationOptions } from "../../app.module.ts";
import { KVManager } from "../kv/kv-manager.ts";
import {
  assertRuntimeDependenciesReady,
  resolveRuntimeRedisUrl,
} from "./runtime-readiness.ts";

type RuntimeCreateApplicationOptions = Omit<CreateApplicationOptions, "database" | "databaseFactory">;
type RuntimeServiceName = NonNullable<RuntimeCreateApplicationOptions["serviceName"]>;

export interface RuntimeInitOptions extends RuntimeCreateApplicationOptions {
  serviceName: RuntimeServiceName;
}

/**
 * init is the single startup entry for long-lived server processes.
 * It performs dependency checks first, then wires the runtime.
 */
export async function init(options: RuntimeInitOptions) {
  console.log(`[runtime:init] 正在执行 init，serviceName=${options.serviceName}`);
  console.log("[runtime:init] 正在执行 KVManager 初始化");
  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() }));
  console.log("[runtime:init] KVManager 初始化完成");

  console.log("[runtime:init] 正在执行运行时依赖检查");
  await assertRuntimeDependenciesReady(kvManager, options.serviceName);
  console.log("[runtime:init] 运行时依赖检查完成");

  console.log("[runtime:init] 正在执行应用创建");
  const runtime = await createApplication({
    ...options,
    kvManager,
  });
  console.log("[runtime:init] 应用创建完成");
  console.log(`[runtime:init] init 完成，serviceName=${options.serviceName}`);
  return runtime;
}
