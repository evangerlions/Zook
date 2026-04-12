import type { LlmModelConfig, LlmProviderConfig } from "../shared/types.ts";

export interface LlmRouteHealthProvider {
  getHealthScore: (route: { modelKey: string; provider: string; providerModel: string }) => Promise<number | undefined>;
}

export interface LlmRouteSelectionOptions {
  model: LlmModelConfig;
  providerMap: Map<string, LlmProviderConfig>;
  healthProvider?: LlmRouteHealthProvider;
  random?: () => number;
}

export async function selectAutoRoute(
  options: LlmRouteSelectionOptions,
): Promise<LlmModelConfig["routes"][number]> {
  const availableRoutes = options.model.routes.filter(
    (route) => route.enabled && options.providerMap.get(route.provider)?.enabled,
  );
  if (!availableRoutes.length) {
    throw new Error(`Model ${options.model.key} does not have any enabled routes.`);
  }

  const scores = await Promise.all(
    availableRoutes.map(async (route) => {
      const healthScore = await options.healthProvider?.getHealthScore({
        modelKey: options.model.key,
        provider: route.provider,
        providerModel: route.providerModel,
      });

      return {
        route,
        score: route.weight * ((healthScore ?? 100) / 100),
      };
    }),
  );

  const totalScore = scores.reduce((sum, item) => sum + item.score, 0);
  const weights = totalScore > 0
    ? scores
    : scores.map((item) => ({
        route: item.route,
        score: item.route.weight,
      }));
  const totalWeight = weights.reduce((sum, item) => sum + item.score, 0);

  if (totalWeight <= 0) {
    throw new Error(`Model ${options.model.key} does not have a routable provider.`);
  }

  const target = (options.random ?? Math.random)() * totalWeight;
  let cursor = 0;
  for (const item of weights) {
    cursor += item.score;
    if (target <= cursor) {
      return item.route;
    }
  }

  return weights[weights.length - 1].route;
}
