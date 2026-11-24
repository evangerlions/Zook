import { sha256 } from "../../../shared/utils.ts";
import { conditionHistory, effectiveDailyLimits } from "../goal-context/confirmed-conditions.ts";
import type { LightTickGoalRow, LightTickPlanRow } from "../lighttick.types.ts";
import type { ManualDraft } from "./manual-planning.types.ts";

export function manualConditionBasis(goal: LightTickGoalRow, draft: ManualDraft, history = conditionHistory(goal)) {
  const { period_start: start, period_end: end } = draft;
  const limits = effectiveDailyLimits(goal, start, end, history);
  const relevant = history.filter(condition => condition.starts_on <= end &&
    (condition.ends_on === null || condition.ends_on >= start)).map(condition => condition.sequence);
  return sha256(JSON.stringify([limits, relevant]));
}

export function manualConditionsRequireReview(goal: LightTickGoalRow, plan: LightTickPlanRow, draft: ManualDraft) {
  if (plan.status !== "proposed") return false;
  const history = conditionHistory(goal);
  const current = manualConditionBasis(goal, draft, history);
  const recorded = plan.proposal.condition_basis;
  if (typeof recorded === "string") return recorded !== current;
  if (!history.length) return false;

  // Older proposals retain their last saved timestamp. On an equal timestamp require review,
  // since these proposals cannot prove they saw the condition written in that instant.
  const previous = history.filter(condition => Date.parse(condition.confirmed_at) < Date.parse(plan.updatedAt));
  return current !== manualConditionBasis(goal, draft, previous);
}
