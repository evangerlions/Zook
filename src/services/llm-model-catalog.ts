import type { LlmModelConfig, LlmServiceConfig } from '../shared/types.ts';

/** Historical provider-specific identities. Upstream model variants stay on routes. */
export const LEGACY_LLM_MODEL_KEYS: Readonly<Record<string, string>> = {
  'tokenplan-qwen3.8-max': 'qwen3.8-max',
  'tokenplan-qwen3.8-flash': 'qwen3.8-flash',
  'tokenplan-qwen3.7-plus': 'qwen3.7-plus',
  'tokenplan-qwen3.7-max': 'qwen3.7-max',
  'tokenplan-qwen3.6-flash': 'qwen3.6-flash',
  'tokenplan-deepseek-v4-pro-0813': 'deepseek-v4-pro',
  'tokenplan-deepseek-v4-pro': 'deepseek-v4-pro',
  'tokenplan-deepseek-v4-flash-0731': 'deepseek-v4-flash',
  'tokenplan-glm-5.2': 'glm-5.2',
  'bai-glm-5.3-flash': 'glm-5.3-flash',
};

/** Keep established traffic weights; newly discovered routes require explicit activation. */
export function addCatalogModels(existing: LlmModelConfig[], incoming: readonly LlmModelConfig[]): LlmModelConfig[] {
  const models = structuredClone(existing);
  for (const item of incoming) {
    const target = models.find(model => model.key === item.key);
    if (!target) { models.push(structuredClone(item)); continue; }
    for (const route of item.routes) {
      if (target.routes.some(current => current.provider === route.provider && current.providerModel === route.providerModel)) continue;
      target.routes.push({ ...structuredClone(route), enabled: false });
    }
  }
  return models;
}

/** Explicit operator draft transformation; never runs automatically on stored configurations. */
export function consolidateLegacyLlmModels(config: LlmServiceConfig) {
  const aliases = config.models.filter(model => LEGACY_LLM_MODEL_KEYS[model.key]);
  const canonical = config.models.filter(model => !LEGACY_LLM_MODEL_KEYS[model.key]);
  const models = addCatalogModels(canonical, aliases.map(model => ({
    ...model, key: LEGACY_LLM_MODEL_KEYS[model.key],
    label: model.label.replace(/^B\.AI\s+/, '').replace(/\s*· Token Plan$/, ''),
  })));
  return {
    config: { ...structuredClone(config), models,
      defaultModelKey: LEGACY_LLM_MODEL_KEYS[config.defaultModelKey] ?? config.defaultModelKey },
    merged: aliases.map(model => ({ from: model.key, to: LEGACY_LLM_MODEL_KEYS[model.key] })),
  };
}

export interface LlmPlanCoverageEntry {
  provider: string;
  modelKey: string;
  providerModels: string[];
  availability: 'listed' | 'retiring';
  minimumPlan?: string;
}

/** Stage documented coverage on existing models only. This does not authorize plan usage. */
export function stageSupportedPlanRoutes(config: LlmServiceConfig, entries: LlmPlanCoverageEntry[]) {
  const incoming: LlmModelConfig[] = [];
  const added: { modelKey: string; provider: string; providerModel: string }[] = [];
  for (const entry of entries) {
    const model = config.models.find(item => item.key === entry.modelKey);
    if (!model || model.kind !== 'chat') continue;
    if (!config.providers.some(provider => provider.key === entry.provider)) {
      throw new Error(`Plan coverage references missing provider ${entry.provider}`);
    }
    for (const providerModel of entry.providerModels) {
      if (model.routes.some(route => route.provider === entry.provider && route.providerModel === providerModel)
        || added.some(route => route.modelKey === model.key && route.provider === entry.provider && route.providerModel === providerModel)) continue;
      incoming.push({ ...model, routes: [{ provider: entry.provider, providerModel, enabled: false, weight: 100 }] });
      added.push({ modelKey: model.key, provider: entry.provider, providerModel });
    }
  }
  return { config: { ...structuredClone(config), models: addCatalogModels(config.models, incoming) }, added };
}
