import { join } from "node:path";
import { resolvePersistentFileStorageRoot } from "../../infrastructure/files/persistent-file-store.ts";
import { isContainerRuntime } from "../../infrastructure/runtime/runtime-readiness.ts";

export function resolveAiNovelDebugTraceRoot(
  insideContainer = isContainerRuntime(),
): string {
  const environment = (
    process.env.DEPLOY_SLOT?.trim() || process.env.APP_ENV?.trim() || ""
  ).toLowerCase();
  if (!insideContainer || environment === "local") {
    return join(process.cwd(), ".zook", "ai-novel-traces");
  }
  return join(resolvePersistentFileStorageRoot(insideContainer), "ai-novel-traces");
}
