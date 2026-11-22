import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow } from "./lighttick.types.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { dateOnly } from "./manual/manual-planning.types.ts";
import { findGoalSubject, subjectIdForPlan } from "./planning/goal-subjects.ts";

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
  subjectId?: string;
  subjectTitle?: string;
}

const twoCalendarDays = 2 * 24 * 60 * 60 * 1000;
const isManual = (plan: LightTickPlanRow) => plan.source === "manual_native" && plan.proposal.manual_schema === 1;
const planningSessionId = (plan: LightTickPlanRow) => plan.source === "ai" && plan.granularity === "week" &&
  typeof plan.proposal.planning_session_id === "string" ? plan.proposal.planning_session_id : undefined;
const newestFirst = (left: LightTickPlanRow, right: LightTickPlanRow) =>
  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
const scopeKey = (goalId: string, subjectId?: string) => `${goalId}/${subjectId ?? ""}`;

function projectCycle(goal: LightTickGoalRow, subjectId: string | undefined, plans: LightTickPlanRow[],
  businessDate: string, currentDrafts: ReadonlyMap<string, string>): LightTickCycleHandoff | undefined {
  const subject = subjectId ? findGoalSubject(goal, subjectId) : undefined;
  if (subjectId && (!subject || subject.archived)) return;
  const current = plans
    .filter(plan => (isManual(plan) || planningSessionId(plan)) && plan.status === "active" && plan.periodStart <= businessDate)
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart) || newestFirst(left, right))[0];
  if (!current || Date.parse(current.periodEnd) - Date.parse(businessDate) > twoCalendarDays) return;
  const next = plans.filter(plan => plan.periodStart > current.periodEnd && plan.periodEnd >= businessDate);
  if (next.some(plan => plan.status === "active" && plan.granularity !== "day")) return;
  const draft = next.filter(plan => plan.status === "proposed" && (isManual(plan) ||
    (currentDrafts.has(plan.id) && plan.proposal.previous_plan_id === current.id)))
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart) || newestFirst(left, right))[0];
  const nextPlanningSessionId = draft && currentDrafts.get(draft.id);
  return {
    goalId: goal.id, goalTitle: goal.title, planId: current.id,
    periodStart: current.periodStart, periodEnd: current.periodEnd,
    state: draft ? "next_draft_pending" : businessDate > current.periodEnd ? "ended" : "ending_soon",
    ...(subject ? { subjectId: subject.id, subjectTitle: subject.title } : {}),
    ...(draft ? { nextDraftId: draft.id } : {}),
    ...(nextPlanningSessionId || (!draft && planningSessionId(current)) ? { planningKind: "conversational" } : {}),
    ...(nextPlanningSessionId ? { nextPlanningSessionId } : {}),
  };
}

export function projectCycleHandoffs(
  goals: LightTickGoalRow[],
  plans: LightTickPlanRow[],
  businessDate: string,
  currentDrafts: ReadonlyMap<string, string> = new Map(),
): LightTickCycleHandoff[] {
  const plansByGoal = new Map<string, Map<string | undefined, LightTickPlanRow[]>>();
  for (const plan of plans) {
    if (plan.source === "learning_schedule" || !["active", "proposed"].includes(plan.status) ||
      !dateOnly(plan.periodStart) || !dateOnly(plan.periodEnd) || plan.periodStart > plan.periodEnd) continue;
    const bySubject = plansByGoal.get(plan.goalId) ?? new Map<string | undefined, LightTickPlanRow[]>();
    const subjectId = subjectIdForPlan(plan);
    const scoped = bySubject.get(subjectId);
    if (scoped) scoped.push(plan);
    else bySubject.set(subjectId, [plan]);
    plansByGoal.set(plan.goalId, bySubject);
  }

  const handoffs: LightTickCycleHandoff[] = [];
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    for (const [subjectId, scoped] of plansByGoal.get(goal.id) ?? []) {
      const handoff = projectCycle(goal, subjectId, scoped, businessDate, currentDrafts);
      if (handoff) handoffs.push(handoff);
    }
  }
  return handoffs.sort((left, right) => left.periodEnd.localeCompare(right.periodEnd) ||
    scopeKey(left.goalId, left.subjectId).localeCompare(scopeKey(right.goalId, right.subjectId)));
}

export async function readCycleHandoffs(repository: LightTickRepository, owner: LightTickOwner,
  goals: LightTickGoalRow[], plans: LightTickPlanRow[], businessDate: string, now: string) {
  const candidates = projectCycleHandoffs(goals, plans, businessDate);
  if (!candidates.length) return candidates;
  const periodEnds = new Map(candidates.map(candidate => [scopeKey(candidate.goalId, candidate.subjectId), candidate.periodEnd]));
  const linked = plans.flatMap(plan => {
    const sessionId = planningSessionId(plan);
    const periodEnd = periodEnds.get(scopeKey(plan.goalId, subjectIdForPlan(plan)));
    return sessionId && plan.status === "proposed" && periodEnd && plan.periodStart > periodEnd &&
      plan.periodEnd >= businessDate ? [{ sessionId, plan }] : [];
  });
  const sessions = new Map(await Promise.all([...new Set(linked.map(item => item.sessionId))].map(async id =>
    [id, await repository.getPlanningSession(owner, id)] as const)));
  const currentDrafts = new Map(linked.flatMap(({ plan, sessionId }) => {
    const session = sessions.get(sessionId);
    return session?.goalId === plan.goalId && session.subjectId === subjectIdForPlan(plan) &&
      session.status === "draft_ready" && session.draftPlanId === plan.id &&
      session.draftRevision === session.contextRevision &&
      !!session.draftExpiresAt && session.draftExpiresAt > now ? [[plan.id, sessionId] as const] : [];
  }));
  return projectCycleHandoffs(goals, plans, businessDate, currentDrafts);
}
