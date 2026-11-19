import { ConfigRevisionManager } from "../../src/infrastructure/kv/config-revision-manager.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { BailianOpenAICompatibleProvider } from "../../src/services/bailian-openai-compatible-provider.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { OpenRouterOpenAICompatibleProvider } from "../../src/services/openrouter-openai-compatible-provider.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { SecretReferenceResolver } from "../../src/services/secret-reference-resolver.ts";
import type { LlmServiceConfig } from "../../src/shared/types.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";

export const qualityScenes = ["learning_route", "learning_lesson", "learning_schedule"] as const;
type QualityScene = typeof qualityScenes[number];
export interface RateCard {
  provider: string;
  model: string;
  input_usd_per_million: number;
  output_usd_per_million: number;
  source: string;
}

export async function loadQualityRoute(redisUrl: string, modelKey: string, providerKey?: string) {
  const kv = await KVManager.create({ redisUrl });
  try {
    const revision = await new ConfigRevisionManager<string>(kv, { scope: "app-config-revision:common:common.llm_service" }).getLatest();
    const config = revision && JSON.parse(revision.content) as LlmServiceConfig;
    if (!config?.enabled) throw Error("The existing Zook model configuration is missing or disabled.");
    const model = config.models.find(item => item.key === modelKey && item.kind === "chat");
    if (!model) throw Error("The requested Zook logical chat model is missing.");
    const resolver = new SecretReferenceResolver(new CommonPasswordConfigService(new PasswordManager(kv)));
    for (const route of model.routes) {
      if (!route.enabled || (providerKey && route.provider !== providerKey)) continue;
      const provider = config.providers.find(item => item.key === route.provider && item.enabled);
      if (!provider) continue;
      const url = new URL(provider.baseUrl);
      const coding = provider.key === "bailian_coding" || /^coding[.-]/i.test(url.hostname);
      if (coding || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) continue;
      let key: string;
      try { key = await resolver.resolveString(provider.apiKey); } catch { continue; }
      if (!key || /mock|placeholder|^\*+$/i.test(key)) continue;
      // Replicate the configured direct chat adapter. Routes needing a proxy or
      // a different protocol must be evaluated through their native deployment.
      const adapterType = provider.type ?? provider.key;
      if (!["bailian", "bailian_token_plan", "openrouter"].includes(adapterType)) continue;
      if (adapterType === "openrouter" && config.openRouter?.useTransparentProxy) continue;
      const metadata = { revision: revision!.revision, modelKey, provider: provider.key, providerModel: route.providerModel, host: url.hostname };
      const useFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });
      const adapter = adapterType === "openrouter" ? new OpenRouterOpenAICompatibleProvider({ baseUrl: url.href, apiKey: key, fetchImplementation: useFetch }) :
        new BailianOpenAICompatibleProvider({ providerName: provider.key, baseUrl: url.href, apiKey: key, fetchImplementation: useFetch });
      return {
        metadata,
        async complete(request: LLMCompletionRequest) {
          return adapter.complete({
            ...request, providerOptions: { ...request.providerOptions, zookLogBodyMode: "suppress" },
            model: {
              openRouter: route.openRouter, provider: provider.key, modelKey, resolvedModelKey: modelKey, providerModel: route.providerModel,
              providerConfig: { baseUrl: url.href, apiKey: key, timeoutMs: provider.timeoutMs },
            },
          });
        },
      };
    }
    throw Error("No enabled, credentialed general-purpose route is available for batch evaluation.");
  } finally {
    await kv.disconnect();
  }
}

const rateCost = (input: number, output: number, rates: RateCard) =>
  (input * rates.input_usd_per_million + output * rates.output_usd_per_million) / 1_000_000;
export function evaluateBudget(counts: Record<QualityScene, number>, route: {provider: string;providerModel: string}, rates: RateCard, ceilingUsd: number) {
  if (rates?.provider !== route.provider || rates.model !== route.providerModel ||
      !Number.isFinite(rates.input_usd_per_million) || rates.input_usd_per_million < 0 ||
      !Number.isFinite(rates.output_usd_per_million) || rates.output_usd_per_million < 0 ||
      typeof rates.source !== "string" || !rates.source.startsWith("https://") ||
      !Number.isFinite(ceilingUsd) || ceilingUsd <= 0) {
    throw Error("A verified USD rate card for the selected provider/model and an explicit budget are required.");
  }
  const phases = qualityScenes.map(name => {
    const scene = LIGHTTICK_AI_SCENES[name];
    const inputTokens = scene.maxContextTokens + 256;
    const upperUsd = rateCost(inputTokens, scene.maxOutputTokens, rates);
    if (counts[name] && upperUsd > scene.maxEstimatedCostUsd)
      throw Error("The selected route exceeds the Zook scene cost ceiling for " + name);
    return { name, calls: counts[name], inputTokens, outputTokens: scene.maxOutputTokens, upperUsd };
  });
  const maximumUsd = phases.reduce((sum, phase) => sum + phase.calls * phase.upperUsd, 0);
  if (maximumUsd > ceilingUsd) throw Error("The worst-case spend exceeds the evaluation budget.");
  return { ceilingUsd, maximumUsd, phases, rates };
}
export function actualCost(usage: {promptTokens: number;completionTokens: number}, rates: RateCard) {
  return rateCost(usage.promptTokens, usage.completionTokens, rates);
}
