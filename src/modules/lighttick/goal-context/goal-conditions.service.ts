import type { LightTickRepository } from '../lighttick.repository.ts';
import type { LightTickOwner } from '../lighttick.types.ts';
import { ApplicationError } from '../../../shared/errors.ts';
import { randomId } from '../../../shared/utils.ts';
import { ManualPlanningService } from '../manual/manual-planning.service.ts';
import { conditionHistory,conditionRevision,conditionsValue,assertDailyCapacity } from './confirmed-conditions.ts';
/** Confirmed goal conditions are part of the existing goal audit, not a second planning engine. */
export class GoalConditionsService {
  constructor(readonly repository: LightTickRepository,readonly clock=() => new Date(),readonly assertActive: () => Promise<void>=async () => { }) { }
  private async goal(owner: LightTickOwner,id: string) {
    const goal=await this.repository.getGoal(owner,id);
    if(!goal)
      throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','Goal was not found.');
    return goal;
  }
  async context(owner: LightTickOwner,id: string,start: string,end: string) {
    const goal=await this.goal(owner,id);
    const [tasks,reflections,profile,plans]=await Promise.all([this.repository.listTasks(owner),this.repository.listReflections(owner),this.repository.getProfile(owner),this.repository.listPlans(owner,id)]);
    const ownTasks=tasks.filter(t => t.goalId===id);
    // Reading an overbooked window is allowed: show the excess without changing any work.
    const daily_limits=assertDailyCapacity(goal,start,end,[],ownTasks,new Set(),profile?.timezone??'UTC',false);
    const conditions=conditionHistory(goal);
    return { goal,timezone: profile?.timezone??'UTC',tasks: ownTasks,reflections: reflections.filter(r => r.goalId===id),plans,conditions,daily_limits };
  }
  async confirm(owner: LightTickOwner,id: string,key: string,input: Record<string,unknown>) {
    return new ManualPlanningService(this.repository,this.clock,this.assertActive).operation(owner,key,'goal-condition:'+id,input,async () => {
      const current=await this.goal(owner,id),now=this.clock().toISOString(),condition=conditionRevision(current,input,now);
      const goal=await this.repository.saveGoal({ ...current,constraints: { ...current.constraints,confirmed_planning_conditions: conditionsValue(current,condition) },updatedAt: now },{
        event: { ...owner,id: randomId('lighttick_event'),aggregateType: 'goal',aggregateId: id,eventType: condition.active? 'goal_condition_confirmed':'goal_condition_invalidated',aggregateVersion: current.version+1,payload: { condition_id: condition.id,condition_version: condition.revision,scope: condition.scope },occurredAt: now,createdAt: now },
        change: { ...owner,entityType: 'goal',entityId: id,entityVersion: current.version+1,operation: 'upsert',snapshot: { id,title: current.title,status: current.status,constraints: { ...current.constraints,confirmed_planning_conditions: conditionsValue(current,condition) },version: current.version+1 },changedAt: now }
      },current.version);
      return { goal,condition };
    });
  }
}
