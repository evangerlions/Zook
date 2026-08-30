import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "./lighttick.types.ts";
import { transitionGoal, transitionPlan } from "./lighttick-state-machines.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

export interface ProposedTaskInput { title: string; estimatedMinutes: number; priority?: number; scheduledFor?: string; }
export interface ProposedPlanInput {
  goalId: string; granularity: LightTickPlanRow["granularity"]; periodStart: string; periodEnd: string;
  source: string; tasks: ProposedTaskInput[];
}

export class LightTickPlanService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async list(owner: LightTickOwner, goalId?: string): Promise<LightTickPlanRow[]> {
    return await this.repository.listPlans(owner, goalId);
  }

  async createProposed(owner: LightTickOwner, input: ProposedPlanInput): Promise<LightTickPlanRow> {
    await this.requireGoal(owner, input.goalId); this.validateTasks(input.tasks);
    const timestamp = this.clock().toISOString();
    const plan: LightTickPlanRow = { ...owner, id: randomId("lighttick_plan"), goalId: input.goalId,
      granularity: input.granularity, status: "proposed", source: input.source,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      proposal: { tasks: structuredClone(input.tasks) }, version: 1, createdAt: timestamp, updatedAt: timestamp };
    return await this.repository.savePlan(plan, this.write(plan, "plan_proposed", 1, timestamp));
  }

  async confirm(owner: LightTickOwner, planId: string, baseVersion: number): Promise<{ plan: LightTickPlanRow; tasks: LightTickTaskRow[] }> {
    const current = await this.repository.getPlan(owner, planId);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
    transitionPlan(current.status as "proposed", "active");
    const taskInputs = Array.isArray(current.proposal.tasks) ? current.proposal.tasks as unknown as ProposedTaskInput[] : [];
    this.validateTasks(taskInputs); const timestamp = this.clock().toISOString();
    return await this.repository.transaction(owner, async () => {
      const goal = await this.requireGoal(owner, current.goalId);
      if (goal.status === "draft") {
        const nextGoal = { ...goal, status: transitionGoal("draft", "active"), updatedAt: timestamp };
        await this.repository.saveGoal(nextGoal, {
          event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
            eventType: "goal_activated", aggregateVersion: goal.version + 1, payload: {}, occurredAt: timestamp, createdAt: timestamp },
          change: { ...owner, entityType: "goal", entityId: goal.id, entityVersion: goal.version + 1,
            operation: "upsert", snapshot: { status: "active" }, changedAt: timestamp },
        }, goal.version);
      }
      const active = await this.repository.savePlan({ ...current, status: "active", updatedAt: timestamp },
        this.write(current, "plan_confirmed", baseVersion + 1, timestamp), baseVersion);
      const tasks: LightTickTaskRow[] = [];
      for (const input of taskInputs) {
        const task: LightTickTaskRow = { ...owner, id: randomId("lighttick_task"), goalId: current.goalId,
          planId: current.id, title: input.title.trim(), status: "pending", priority: input.priority ?? 0,
          estimatedMinutes: input.estimatedMinutes, scheduledFor: input.scheduledFor,
          version: 1, createdAt: timestamp, updatedAt: timestamp };
        tasks.push(await this.repository.saveTask(task, {
          event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: task.id,
            eventType: "task_materialized", aggregateVersion: 1, payload: { plan_id: planId }, occurredAt: timestamp, createdAt: timestamp },
          change: { ...owner, entityType: "task", entityId: task.id, entityVersion: 1,
            operation: "upsert", snapshot: { title: task.title, status: task.status }, changedAt: timestamp },
        }));
      }
      return { plan: active, tasks };
    });
  }

  private async requireGoal(owner: LightTickOwner, id: string) {
    const goal = await this.repository.getGoal(owner, id);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    return goal;
  }
  private validateTasks(tasks: ProposedTaskInput[]) {
    if (!tasks.length || tasks.length > 50 || tasks.some(task => !task.title?.trim() || task.title.trim().length > 200 ||
      !Number.isInteger(task.estimatedMinutes) || task.estimatedMinutes < 1 || task.estimatedMinutes > 1440)) {
      throw new ApplicationError(400, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Proposed tasks violate plan constraints.");
    }
  }
  private write(plan: LightTickPlanRow, eventType: string, version: number, timestamp: string) {
    return {
      event: { appId: plan.appId, userId: plan.userId, id: randomId("lighttick_event"), aggregateType: "plan",
        aggregateId: plan.id, eventType, aggregateVersion: version, payload: {}, occurredAt: timestamp, createdAt: timestamp },
      change: { appId: plan.appId, userId: plan.userId, entityType: "plan", entityId: plan.id,
        entityVersion: version, operation: "upsert" as const, snapshot: { status: eventType === "plan_confirmed" ? "active" : "proposed" },
        changedAt: timestamp },
    };
  }
}
