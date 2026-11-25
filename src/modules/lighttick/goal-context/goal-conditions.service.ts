import type { LightTickRepository } from '../lighttick.repository.ts';
import type { LightTickGoalRow, LightTickOwner } from '../lighttick.types.ts';
import { ApplicationError } from '../../../shared/errors.ts';
import { randomId } from '../../../shared/utils.ts';
import { readConditionAdjustments } from './condition-adjustments.ts';
import { todayDateAt } from '../lighttick-today.service.ts';
import { ManualPlanningService } from '../manual/manual-planning.service.ts';
import { conditionHistory,conditionRevision,conditionsValue,assertDailyCapacity,type ConditionRevision } from './confirmed-conditions.ts';
export async function saveReviewedGoalCondition(repository: LightTickRepository, owner: LightTickOwner,
  current: LightTickGoalRow, condition: ConditionRevision, now: string) {
  const constraints = { ...current.constraints, confirmed_planning_conditions: conditionsValue(current, condition) };
  const version = current.version + 1;
  const goal = await repository.saveGoal({ ...current, constraints, updatedAt: now }, {
    event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: current.id,
      eventType: condition.active ? "goal_condition_confirmed" : "goal_condition_invalidated", aggregateVersion: version,
      payload: { condition_id: condition.id, condition_version: condition.revision, scope: condition.scope }, occurredAt: now, createdAt: now },
    change: { ...owner, entityType: "goal", entityId: current.id, entityVersion: version, operation: "upsert",
      snapshot: { id: current.id, title: current.title, status: current.status, constraints, version }, changedAt: now },
  }, current.version);
  // C3 4.1 双写：表 B 镜像列 A 的 constraints（读仍走列 A）
  await repository.saveGoalContext({ appId: owner.appId, userId: owner.userId, goalId: current.id,
    desiredOutcome: {}, currentLevel: {}, deadline: {}, weeklyAvailableMinutes: {},
    constraints: goal.constraints, version: 1, createdAt: now, updatedAt: now });
  return goal;
}

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
    return this.repository.transaction(owner, async () => {
      const goal=await this.goal(owner,id);
      const tasks = await this.repository.listTasks(owner);
      const reflections = await this.repository.listReflections(owner);
      const profile = await this.repository.getProfile(owner);
      const plans = await this.repository.listPlans(owner, id);
      const ownTasks=tasks.filter(t => t.goalId===id);
      const { timezone, businessDate } = todayDateAt(this.clock(), profile?.timezone ?? "UTC");
      // Reading an overbooked window is allowed: show the excess without changing any work.
      const daily_limits=assertDailyCapacity(goal,start,end,[],ownTasks,new Set(),timezone,false);
      const conditions=conditionHistory(goal);
      const adjustment = ["draft", "active", "recovering"].includes(goal.status) ? readConditionAdjustments([goal], plans, ownTasks, businessDate, timezone)[0] : undefined;
      const condition_adjustment = adjustment ? { task_count: adjustment.task_count, starts_on: adjustment.starts_on, ends_on: adjustment.ends_on } : undefined;
      return { goal,timezone,tasks: ownTasks,reflections: reflections.filter(r => r.goalId===id),plans,conditions,daily_limits,condition_adjustment };
    });
  }
  async confirm(owner: LightTickOwner,id: string,key: string,input: Record<string,unknown>) {
    return new ManualPlanningService(this.repository,this.clock,this.assertActive).operation(owner,key,'goal-condition:'+id,input,async () => {
      const current=await this.goal(owner,id),now=this.clock().toISOString(),condition=conditionRevision(current,input,now);
      const goal = await saveReviewedGoalCondition(this.repository, owner, current, condition, now);
      return { goal,condition };
    });
  }
}
