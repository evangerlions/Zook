import type { LightTickRepository } from '../lighttick.repository.ts';
import type { LightTickOwner,LightTickGoalRow,LightTickTaskRow } from '../lighttick.types.ts';
import type { ManualDraft } from './manual-planning.types.ts';
import { ApplicationError } from '../../../shared/errors.ts';
import { assertDailyCapacity } from '../goal-context/confirmed-conditions.ts';
const changed=(message: string): never => { throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT',message); };
export async function reviewManualContinuation(repository: LightTickRepository,owner: LightTickOwner,goal: LightTickGoalRow,draft: ManualDraft,tasks: LightTickTaskRow[],timezone: string,confirmingPlanId?: string) {
  const replacements=(draft.replace_tasks??[]).map(ref => {
    const task=tasks.find(t => t.id===ref.id&&t.goalId===goal.id);
    if(!task)
      throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','The reviewed source task was not found for this goal.');
    if(task.version!==ref.version||!['pending','in_progress'].includes(task.status))
      changed('A reviewed task changed or already became historical; preserve input and review it again.');
    return task;
  });
  if(draft.resume_goal) {
    if(!['paused','recovering'].includes(goal.status))
      changed('The goal no longer needs this reviewed resumption.');
    const ids=new Set(replacements.map(t => t.id));
    if(tasks.some(t => t.goalId===goal.id&&['pending','in_progress'].includes(t.status)&&!ids.has(t.id)))
      changed('Review every outstanding item before resuming. Unselected work cannot silently reactivate.');
  }
  let source: undefined|{
    id: string;
    version: number;
    goal_id: string;
    content: string;
    next_action: string;
    period_start: string;
    period_end: string;
  };
  if(draft.source_reflection_id) {
    const entry=(await repository.listReflections(owner)).find(r => r.id===draft.source_reflection_id&&r.goalId===goal.id);
    if(!entry)
      throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','The selected reflection was not found for this goal.');
    if(entry.version!==draft.source_reflection_version)
      changed('The selected reflection changed; review its current revision.');
    if(confirmingPlanId&&(await repository.listPlans(owner,goal.id)).some(p => { const d=p.proposal.draft as ManualDraft|undefined; return p.id!==confirmingPlanId&&['active','superseded'].includes(p.status)&&d?.source_reflection_id===entry.id&&d.source_reflection_version===entry.version; }))
      changed('This reflection revision already has a confirmed next arrangement.');
    source={ id: entry.id,version: entry.version,goal_id: entry.goalId,content: entry.content,next_action: entry.nextAction,period_start: entry.periodStart,period_end: entry.periodEnd };
  }
  const dailyLimits=assertDailyCapacity(goal,draft.period_start,draft.period_end,draft.tasks,tasks,new Set(replacements.map(t => t.id)),timezone,!!confirmingPlanId);
  return { replacements,source,dailyLimits };
}
