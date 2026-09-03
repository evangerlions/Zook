import type {
  LlmHealthFailureMetricsGroup,
  LlmRouteMetricsGroup,
} from "../../lib/types";

export interface TopRoutingModelOption {
  modelKey: string;
  requestCount: number;
}

export function buildTopRoutingModelOptions(
  routes: LlmRouteMetricsGroup[],
  limit = 5,
): TopRoutingModelOption[] {
  const counts = new Map<string, number>();
  for (const route of routes) {
    counts.set(
      route.routingModelKey,
      (counts.get(route.routingModelKey) ?? 0) + route.summary.requestCount,
    );
  }
  return [...counts.entries()]
    .map(([modelKey, requestCount]) => ({ modelKey, requestCount }))
    .sort((left, right) =>
      right.requestCount - left.requestCount || left.modelKey.localeCompare(right.modelKey),
    )
    .slice(0, limit);
}

export function filterHealthFailures(
  failures: LlmHealthFailureMetricsGroup[],
  modelKey: string,
): LlmHealthFailureMetricsGroup[] {
  return modelKey
    ? failures.filter((item) => item.routingModelKey === modelKey)
    : failures;
}
