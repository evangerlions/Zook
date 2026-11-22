import type { LightTickGoalRow, LightTickPlanRow } from "./lighttick.types.ts";
import { dateOnly } from "./manual/manual-planning.types.ts";

export interface LightTickCycleHandoff {
  goalId: string;
  goalTitle: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  state: "ending_soon" | "next_draft_pending" | "ended";
  nextDraftId?: string;
}

const twoCalendarDays = 2 * 24 * 60 * 60 * 1000;
const isManual = (plan: LightTickPlanRow) => plan.source === "manual_native" && plan.proposal.manual_schema === 1;
const newestFirst = (left: LightTickPlanRow, right: LightTickPlanRow) =>
  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);

export function projectCycleHandoffs(
  goals: LightTickGoalRow[],
  plans: LightTickPlanRow[],
  businessDate: string,
): LightTickCycleHandoff[] {
  const plansByGoal = new Map<string, LightTickPlanRow[]>();
  for (const plan of plans) {
    if (plan.source === "learning_schedule" || !["active", "proposed"].includes(plan.status) ||
      !dateOnly(plan.periodStart) || !dateOnly(plan.periodEnd) || plan.periodStart > plan.periodEnd) continue;
    const existing = plansByGoal.get(plan.goalId);
    if (existing) existing.push(plan);
    else plansByGoal.set(plan.goalId, [plan]);
  }

  const handoffs: LightTickCycleHandoff[] = [];
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const goalPlans = plansByGoal.get(goal.id);
    if (!goalPlans) continue;
    const current = goalPlans
      .filter(plan => isManual(plan) && plan.status === "active" && plan.periodStart <= businessDate)
      .sort((left, right) => right.periodStart.localeCompare(left.periodStart) || newestFirst(left, right))[0];
    if (!current || Date.parse(current.periodEnd) - Date.parse(businessDate) > twoCalendarDays) continue;

    const next = goalPlans.filter(plan => plan.periodStart > current.periodEnd && plan.periodEnd >= businessDate);
    if (next.some(plan => plan.status === "active" && plan.granularity !== "day")) continue;
    const draft = next.filter(plan => plan.status === "proposed" && isManual(plan))
      .sort((left, right) => left.periodStart.localeCompare(right.periodStart) || newestFirst(left, right))[0];
    handoffs.push({
      goalId: goal.id,
      goalTitle: goal.title,
      planId: current.id,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      state: draft ? "next_draft_pending" : businessDate > current.periodEnd ? "ended" : "ending_soon",
      ...(draft ? { nextDraftId: draft.id } : {}),
    });
  }
  return handoffs.sort((left, right) => left.periodEnd.localeCompare(right.periodEnd) || left.goalId.localeCompare(right.goalId));
}
