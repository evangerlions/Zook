import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickTaskRow } from "../lighttick.types.ts";
import { assertSubjectPlacement, subjectIdForPlan } from "../planning/goal-subjects.ts";
import { invalid, type ManualDraft } from "./manual-planning.types.ts";

/** Reviewed transfers keep the subject of their original work. */
export async function resolveManualPlanSubject(repository: LightTickRepository, goal: LightTickGoalRow,
  draft: ManualDraft, replacements: LightTickTaskRow[], implicitSingleSource: boolean) {
  const sources = new Set(draft.tasks.flatMap(task => task.source_task_id ? [task.source_task_id] : []));
  const usesOneSource = implicitSingleSource && replacements.length === 1;
  if (usesOneSource) sources.add(replacements[0]!.id);
  const carried = replacements.filter(task => sources.has(task.id));
  let subjectId = draft.subject_id;
  if (carried.length) {
    const plans = new Map((await repository.listPlans(goal, goal.id)).map(plan => [plan.id, plan] as const));
    const subjects = new Set(carried.flatMap(task => {
      const plan = plans.get(task.planId);
      const id = plan && subjectIdForPlan(plan);
      return id ? [id] : [];
    }));
    if (subjects.size > 1) invalid("Review transfers for one subject at a time.");
    const inherited = subjects.values().next().value;
    if (inherited) {
      if (subjectId !== undefined && subjectId !== inherited) invalid("Transferred work must remain with its original subject.");
      if (subjectId === undefined && !usesOneSource && draft.tasks.some(task => !task.source_task_id))
        invalid("Review new work separately from a subject's carried actions.");
      subjectId = inherited;
    }
  }
  if (subjectId) assertSubjectPlacement(goal, subjectId);
  return subjectId === draft.subject_id ? draft : { ...draft, subject_id: subjectId };
}
