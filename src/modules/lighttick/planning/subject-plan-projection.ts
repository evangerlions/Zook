import type { LightTickGoalRow, LightTickPlanRow } from "../lighttick.types.ts";
import { findGoalSubject, subjectIdForPlan } from "./goal-subjects.ts";

export function subjectForPlan(plan: LightTickPlanRow | undefined, goal: LightTickGoalRow | undefined) {
  if (!plan || !goal || plan.goalId !== goal.id) return undefined;
  const subjectId = subjectIdForPlan(plan);
  return subjectId ? findGoalSubject(goal, subjectId) : undefined;
}

export function planSubjectData(plan: LightTickPlanRow | undefined, goal: LightTickGoalRow | undefined) {
  const subject = subjectForPlan(plan, goal);
  return subject ? { subject_id: subject.id, subject_title: subject.title } : undefined;
}
