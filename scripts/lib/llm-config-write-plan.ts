/** Payloads match the existing Admin HTTP APIs; LLM uses a flat request body. */
import type { KimiUpgradeDraft } from './llm-kimi-upgrade-draft.ts';

export const LLM_CONFIG_ADMIN_PATHS = {
  llm: '/apps/common/llm-service',
  selection: '/apps/ai_novel/model-selection',
  pricing: '/apps/ai_novel/model-point-pricing',
} as const;

type ConfigKey = keyof KimiUpgradeDraft;
interface ConfigStep {
  key: ConfigKey;
  config: KimiUpgradeDraft[ConfigKey];
}

export function buildLlmConfigWritePlan(source: KimiUpgradeDraft, target: KimiUpgradeDraft, desc: string) {
  const finalKeys = new Set(target.llm.models.map(model => model.key));
  const sourcePrices = new Set(source.pricing.models.map(model => model.modelKey));
  const pricingBridge = { ...source.pricing, models: [...source.pricing.models,
    ...target.pricing.models.filter(model => !sourcePrices.has(model.modelKey))] };
  const llmBridge = { ...target.llm, models: [...target.llm.models,
    ...source.llm.models.filter(model => !finalKeys.has(model.key))] };
  const steps: ConfigStep[] = [
    { key: 'pricing', config: pricingBridge }, { key: 'llm', config: llmBridge },
    { key: 'selection', config: target.selection }, { key: 'llm', config: target.llm },
    { key: 'pricing', config: target.pricing },
  ];
  return steps.map(step => ({ ...step, path: LLM_CONFIG_ADMIN_PATHS[step.key],
    body: step.key === 'llm' ? { ...step.config, desc } : { config: step.config, desc },
  }));
}
