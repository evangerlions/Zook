import type {
  LlmModelRouteConfig,
  LlmRoutingStrategy,
} from "../shared/types.ts";

export type LlmRouteSelectionReason =
  | "health_weighted"
  | "static_weight_fallback"
  | "fixed_highest_weight"
  | "compatibility_fallback"
  | "not_selected"
  | "ineligible";

export interface LlmRouteScoreInput {
  route: LlmModelRouteConfig;
  providerEnabled: boolean;
  runtimeAvailable: boolean;
  healthScore: number;
}

export interface LlmRouteScoreEvaluation {
  route: LlmModelRouteConfig;
  selectionEligible: boolean;
  runtimeAvailable: boolean;
  ineligibleReason?: "route_disabled" | "provider_disabled" | "runtime_unavailable";
  configuredWeight: number;
  healthScore: number;
  dynamicScore: number;
  effectiveProbability: number;
  selectionReason: LlmRouteSelectionReason;
  selected: boolean;
}

export interface LlmRoutingEvaluation {
  strategy: LlmRoutingStrategy;
  routes: LlmRouteScoreEvaluation[];
  totalSelectionWeight: number;
}

export function evaluateLlmRoutes(
  strategy: LlmRoutingStrategy,
  inputs: LlmRouteScoreInput[],
): LlmRoutingEvaluation {
  return strategy === "fixed"
    ? evaluateFixedRoutes(inputs)
    : evaluateAutoRoutes(inputs);
}

export function selectLlmRoute(
  evaluation: LlmRoutingEvaluation,
  random: () => number = Math.random,
): LlmRouteScoreEvaluation | undefined {
  if (evaluation.strategy === "fixed") {
    return evaluation.routes.find((route) => route.selected);
  }
  if (evaluation.totalSelectionWeight <= 0) {
    return undefined;
  }
  const unit = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  const target = unit * evaluation.totalSelectionWeight;
  let cursor = 0;
  for (const route of evaluation.routes) {
    cursor += route.effectiveProbability;
    if (target < cursor) {
      return route;
    }
  }
  return [...evaluation.routes].reverse().find((route) => route.effectiveProbability > 0);
}

export function roundRoutingValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function evaluateAutoRoutes(inputs: LlmRouteScoreInput[]): LlmRoutingEvaluation {
  const base = inputs.map(buildBaseEvaluation);
  const eligible = base.filter((item) => item.selectionEligible);
  const dynamicTotal = eligible.reduce((sum, item) => sum + item.dynamicScore, 0);
  const configuredTotal = eligible.reduce((sum, item) => sum + item.configuredWeight, 0);
  const useStaticFallback = dynamicTotal <= 0 && configuredTotal > 0;
  const total = dynamicTotal > 0 ? dynamicTotal : configuredTotal;
  const reason: LlmRouteSelectionReason = useStaticFallback
    ? "static_weight_fallback"
    : "health_weighted";

  return {
    strategy: "auto",
    totalSelectionWeight: total > 0 ? 100 : 0,
    routes: base.map((item) => {
      const score = useStaticFallback ? item.configuredWeight : item.dynamicScore;
      const probability = item.selectionEligible && total > 0 ? (score / total) * 100 : 0;
      return {
        ...item,
        effectiveProbability: probability,
        selectionReason: item.selectionEligible ? reason : "ineligible",
        selected: false,
      };
    }),
  };
}

function evaluateFixedRoutes(inputs: LlmRouteScoreInput[]): LlmRoutingEvaluation {
  const base = inputs.map(buildBaseEvaluation);
  const eligible = base.filter((item) => item.selectionEligible && item.runtimeAvailable);
  const selected = eligible.length
    ? eligible.reduce((best, item) => item.configuredWeight > best.configuredWeight ? item : best)
    : base.find((item) => item.runtimeAvailable);
  const compatibilityFallback = eligible.length === 0 && Boolean(selected);

  return {
    strategy: "fixed",
    totalSelectionWeight: selected ? 100 : 0,
    routes: base.map((item) => ({
      ...item,
      effectiveProbability: item === selected ? 100 : 0,
      selectionReason: item === selected
        ? compatibilityFallback ? "compatibility_fallback" : "fixed_highest_weight"
        : item.selectionEligible ? "not_selected" : "ineligible",
      selected: item === selected,
    })),
  };
}

function buildBaseEvaluation(input: LlmRouteScoreInput): LlmRouteScoreEvaluation {
  const selectionEligible = input.route.enabled && input.providerEnabled && input.runtimeAvailable;
  return {
    route: input.route,
    selectionEligible,
    runtimeAvailable: input.runtimeAvailable,
    ineligibleReason: !input.route.enabled
      ? "route_disabled"
      : !input.providerEnabled
        ? "provider_disabled"
        : !input.runtimeAvailable
          ? "runtime_unavailable"
          : undefined,
    configuredWeight: input.route.weight,
    healthScore: input.healthScore,
    dynamicScore: input.route.weight * (input.healthScore / 100),
    effectiveProbability: 0,
    selectionReason: selectionEligible ? "not_selected" : "ineligible",
    selected: false,
  };
}
