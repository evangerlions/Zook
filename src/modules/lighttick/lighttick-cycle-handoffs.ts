import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow } from "./lighttick.types.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { dateOnly } from "./manual/manual-planning.types.ts";

export interface LightTickCycleHandoff {
  goalId: string;
  goalTitle: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  state: "ending_soon" | "next_draft_pending" | "ended";
  nextDraftId?: string;
  nextPlanningSessionId?: string;
  planningKind?: "conversational";
}

const twoCalendarDays = 2 * 24 * 60 * 60 * 1000;
const isManual = (plan: LightTickPlanRow) => plan.source === "manual_native" && plan.proposal.manual_schema === 1;
const planningSessionId = (plan: LightTickPlanRow) => plan.source === "ai" && plan.granularity === "week" &&
  typeof plan.proposal.planning_session_id === "string" ? plan.proposal.planning_session_id : undefined;
const newestFirst = (left: LightTickPlanRow, right: LightTickPlanRow) =>
  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);

export function projectCycleHandoffs(
  goals: LightTickGoalRow[],
  plans: LightTickPlanRow[],
  businessDate: string,
  currentDrafts: ReadonlyMap<string, string> = new Map(),
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
      .filter(plan => (isManual(plan) || planningSessionId(plan)) && plan.status === "active" && plan.periodStart <= businessDate)
      .sort((left, right) => right.periodStart.localeCompare(left.periodStart) || newestFirst(left, right))[0];
    if (!current || Date.parse(current.periodEnd) - Date.parse(businessDate) > twoCalendarDays) continue;

    const next = goalPlans.filter(plan => plan.periodStart > current.periodEnd && plan.periodEnd >= businessDate);
    if (next.some(plan => plan.status === "active" && plan.granularity !== "day")) continue;
    const draft = next.filter(plan => plan.status === "proposed" && (isManual(plan) ||
      (currentDrafts.has(plan.id) && (!plan.proposal.previous_plan_id || plan.proposal.previous_plan_id === current.id))))
      .sort((left, right) => left.periodStart.localeCompare(right.periodStart) || newestFirst(left, right))[0];
    const nextPlanningSessionId = draft && currentDrafts.get(draft.id);
    handoffs.push({
      goalId: goal.id,
      goalTitle: goal.title,
      planId: current.id,
      periodStart: current.periodStart,
      periodEnd: current.periodEnd,
      state: draft ? "next_draft_pending" : businessDate > current.periodEnd ? "ended" : "ending_soon",
      ...(draft ? { nextDraftId: draft.id } : {}),
      ...(nextPlanningSessionId || (!draft && planningSessionId(current)) ? { planningKind: "conversational" } : {}),
      ...(nextPlanningSessionId ? { nextPlanningSessionId } : {}),
    });
  }
  return handoffs.sort((left, right) => left.periodEnd.localeCompare(right.periodEnd) || left.goalId.localeCompare(right.goalId));
}

export async function readCycleHandoffs(repository: LightTickRepository, owner: LightTickOwner,
  goals: LightTickGoalRow[], plans: LightTickPlanRow[], businessDate: string, now: string) {
  const candidates = projectCycleHandoffs(goals, plans, businessDate);
  if (!candidates.length) return candidates;
  const periodEnds = new Map(candidates.map(candidate => [candidate.goalId, candidate.periodEnd]));
  const linked = plans.flatMap(plan => {
    const sessionId = planningSessionId(plan);
    const periodEnd = periodEnds.get(plan.goalId);
    return sessionId && plan.status === "proposed" && periodEnd && plan.periodStart > periodEnd &&
      plan.periodEnd >= businessDate ? [{ sessionId, plan }] : [];
  });
  const sessions = new Map(await Promise.all([...new Set(linked.map(item => item.sessionId))].map(async id =>
    [id, await repository.getPlanningSession(owner, id)] as const)));
  const currentDrafts = new Map(linked.flatMap(({ plan, sessionId }) => {
    const session = sessions.get(sessionId);
    return session?.goalId === plan.goalId && session.status === "draft_ready" && session.draftPlanId === plan.id &&
      session.draftRevision === session.contextRevision &&
      !!session.draftExpiresAt && session.draftExpiresAt > now ? [[plan.id, sessionId] as const] : [];
  }));
  return projectCycleHandoffs(goals, plans, businessDate, currentDrafts);
}
