import { sanitizeBuddyOperationalMetadata } from "./buddy-privacy.ts";

export const buddyRetentionDays = {
  invitationProjection: 90,
  notificationFeed: 90,
  notificationDelivery: 30,
  structuredShare: 30,
  interaction: 90,
  jointActivity: 90,
  completedGoal: 365,
  weeklyReport: 400,
  revokedRelationship: 30,
  auditRecord: 730,
} as const;

export type BuddyGuardrailMetric = "push_opt_out_rate" | "revoke_rate" | "block_rate" |
  "report_rate" | "complaint_rate";

export interface BuddyRolloutDecision {
  enabled: boolean;
  disabledCapabilities: Array<"prompts" | "push" | "growth">;
  breachedMetrics: BuddyGuardrailMetric[];
}

const defaultThresholds: Record<BuddyGuardrailMetric, number> = {
  push_opt_out_rate: 0.15,
  revoke_rate: 0.08,
  block_rate: 0.03,
  report_rate: 0.01,
  complaint_rate: 0.005,
};

/** Evaluates safety guardrails before enabling buddy prompts or Push. */
export function evaluateBuddyRollout(
  metrics: Partial<Record<BuddyGuardrailMetric, number>>,
  thresholds = defaultThresholds,
): BuddyRolloutDecision {
  const breachedMetrics = (Object.keys(thresholds) as BuddyGuardrailMetric[])
    .filter((metric) => (metrics[metric] ?? 0) > thresholds[metric]);
  const safetyBreach = breachedMetrics.some((metric) => metric !== "push_opt_out_rate");
  return {
    enabled: breachedMetrics.length === 0,
    disabledCapabilities: safetyBreach ? ["prompts", "push", "growth"]
      : breachedMetrics.length > 0 ? ["prompts", "push"] : [],
    breachedMetrics,
  };
}

/** Produces an opaque, allow-listed funnel event without protected buddy content. */
export function buddyFunnelMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeBuddyOperationalMetadata(input);
}
