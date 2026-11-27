import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import { ZOOK_CONTEXT_WINDOW_TOKENS } from "../../services/llm-context-window.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { AI_NOVEL_APP_ID } from "./ai-novel-constants.ts";

const DELIVERY_CONFIG_KEY = "admin.delivery_config";
const DEFAULT_IMPORT_CONTEXT_BUDGET_TOKENS = Math.floor(ZOOK_CONTEXT_WINDOW_TOKENS * 0.75);

export async function readAiNovelImportContextBudget(
  service: Pick<VersionedAppConfigService, "getValue">,
): Promise<number> {
  const rawConfig = await service.getValue(AI_NOVEL_APP_ID, DELIVERY_CONFIG_KEY);
  const value = rawConfig === undefined ? undefined : readConfiguredBudget(rawConfig);
  if (value === undefined) return DEFAULT_IMPORT_CONTEXT_BUDGET_TOKENS;
  if (!isValidBudget(value)) {
    throw new ApplicationError(503, "AI_UPSTREAM_CONFIG_INVALID", "Invalid AINovel import context budget.");
  }
  return value;
}

export function validateAiNovelImportContextConfig(appId: string, rawConfig: string): void {
  if (appId !== AI_NOVEL_APP_ID) return;
  const value = readConfiguredBudget(rawConfig);
  if (value !== undefined && !isValidBudget(value)) {
    throw new ApplicationError(400, "ADMIN_CONFIG_INVALID_JSON",
      "importBook.serverContextBudgetTokens must be a positive safe integer.");
  }
}

function readConfiguredBudget(rawConfig: string): unknown {
  const config = JSON.parse(rawConfig) as { importBook?: { serverContextBudgetTokens?: unknown } } | null;
  return config?.importBook?.serverContextBudgetTokens;
}

function isValidBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
