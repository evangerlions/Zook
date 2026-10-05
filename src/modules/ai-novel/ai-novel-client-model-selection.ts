import { badRequest } from "../../shared/errors.ts";
import type { LlmServiceConfig, AiNovelModelPointPricingConfig } from "../../shared/types.ts";
import { ZOOK_CONTEXT_WINDOW_TOKENS } from "../../services/llm-context-window.ts";
import { defaultModelLocalIcon, type ModelCatalogPresentation } from "../../shared/model-catalog-presentation.ts";

export type AiNovelClientModelSelection =
  | { mode: "auto" }
  | { mode: "manual"; modelKey: string };

export interface AiNovelPublicModel {
  key: string;
  label: string;
  localIcon: string;
  onlineIcon: string;
  description?: string;
  badge?: string;
  inputMultiplier: number;
  cachedInputMultiplier: number;
  outputMultiplier: number;
  contextWindowTokens: number;
  contextTiers?: Array<{
    abovePromptTokens: number;
    inputMultiplier: number;
    cachedInputMultiplier: number;
    outputMultiplier: number;
  }>;
}

export function parseAiNovelClientModelSelection(value: unknown): AiNovelClientModelSelection {
  if (value === undefined) return { mode: "auto" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("REQ_INVALID_BODY", "modelSelection must be an object.");
  }
  const source = value as Record<string, unknown>;
  const allowed = source.mode === "auto" ? ["mode"] : ["mode", "modelKey"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) {
    badRequest("REQ_INVALID_BODY", "modelSelection contains unsupported fields.");
  }
  if (source.mode === "auto") return { mode: "auto" };
  if (source.mode === "manual" && typeof source.modelKey === "string" && source.modelKey.trim()) {
    return { mode: "manual", modelKey: source.modelKey.trim() };
  }
  badRequest("REQ_INVALID_BODY", "modelSelection requires auto or manual with a logical modelKey.");
}

/** Product pricing is the product eligibility list; provider credentials never leave this mapper. */
export function buildAiNovelPublicModels(common: LlmServiceConfig, pricing: AiNovelModelPointPricingConfig, catalog: ModelCatalogPresentation[] = []): AiNovelPublicModel[] {
  if (!common.enabled) return [];
  const providers = new Set(common.providers.filter((item) => item.enabled).map((item) => item.key));
  return common.models.flatMap((model) => {
    const display = catalog.find((item) => item.modelKey === model.key);
    if (display?.enabled === false) return [];
    if (model.kind !== "chat" || !model.routes.some((route) => route.enabled && providers.has(route.provider))) return [];
    const rate = pricing.models.find((item) => item.modelKey === model.key);
    if (rate?.inputPointsPerMillionTokens === undefined || rate.outputPointsPerMillionTokens === undefined) return [];
    return [{
      key: model.key, label: display?.label || model.label,
      localIcon: display?.localIcon || defaultModelLocalIcon(model.key),
      onlineIcon: display?.onlineIcon || "",
      ...(display?.description ? { description: display.description } : {}),
      ...(display?.badge ? { badge: display.badge } : {}),
      inputMultiplier: rate.inputPointsPerMillionTokens / 100,
      cachedInputMultiplier: (rate.cachedInputPointsPerMillionTokens ?? rate.inputPointsPerMillionTokens) / 100,
      outputMultiplier: rate.outputPointsPerMillionTokens / 100,
      contextWindowTokens: ZOOK_CONTEXT_WINDOW_TOKENS,
      ...(rate.contextTiers?.length ? { contextTiers: rate.contextTiers.map((tier) => ({
        abovePromptTokens: tier.abovePromptTokens,
        inputMultiplier: tier.inputPointsPerMillionTokens / 100,
        cachedInputMultiplier: (rate.cachedInputPointsPerMillionTokens ?? tier.inputPointsPerMillionTokens) / 100,
        outputMultiplier: tier.outputPointsPerMillionTokens / 100,
      })) } : {}),
    }];
  }).sort((a, b) => {
    const order = (key: string) => catalog.find((item) => item.modelKey === key)?.sortOrder ?? 0;
    return order(a.key) - order(b.key) || a.label.localeCompare(b.label);
  });
}
