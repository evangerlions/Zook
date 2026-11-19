/** Explicit operator draft; never applied during production startup. */
import type { AiNovelModelPointPricingConfig, AiNovelModelSelectionConfig, LlmServiceConfig } from '../../src/shared/types.ts';

export const KIMI_UPGRADE = { from: 'kimi-k3', to: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro' } as const;
interface KimiUpgradeDraft {
  llm: LlmServiceConfig;
  selection: AiNovelModelSelectionConfig;
  pricing: AiNovelModelPointPricingConfig;
}
const upstreamByType: Readonly<Record<string, string>> = {
  volcengine_agent_plan: 'kimi-k3.1-pro',
  bai: 'kimi-k3.1-pro',
  openrouter: 'moonshotai/kimi-k3.1-pro',
};

/** Product point amounts are deliberately retained for this operator draft. */
export function upgradeKimiModelDraft(source: KimiUpgradeDraft): KimiUpgradeDraft {
  const draft = structuredClone(source);
  const { from, to, label } = KIMI_UPGRADE;
  const model = draft.llm.models.find(item => item.key === from);
  if (!model) return draft;
  if (draft.llm.models.some(item => item.key === to)
    || draft.pricing.models.some(item => item.modelKey === to)
    || draft.selection.chat.default.some(item => item.modelKey === to)
    || draft.selection.catalog?.some(item => item.modelKey === to)) {
    throw new Error(`Kimi upgrade target ${to} already exists; resolve the conflicting draft first`);
  }
  model.routes = model.routes.map(route => {
    const provider = draft.llm.providers.find(item => item.key === route.provider);
    const providerType = provider?.type ?? route.provider;
    const providerModel = upstreamByType[providerType];
    if (!providerModel) throw new Error(`Kimi upgrade has no verified upstream for ${route.provider}`);
    return { ...route, providerModel };
  });
  model.key = to;
  model.label = label;
  if (draft.llm.defaultModelKey === from) draft.llm.defaultModelKey = to;
  for (const entry of draft.selection.chat.default) if (entry.modelKey === from) entry.modelKey = to;
  for (const entry of draft.selection.catalog ?? []) {
    if (entry.modelKey !== from) continue;
    entry.modelKey = to;
    if (entry.label !== undefined) entry.label = label;
  }
  for (const entry of draft.pricing.models) if (entry.modelKey === from) entry.modelKey = to;
  return draft;
}
