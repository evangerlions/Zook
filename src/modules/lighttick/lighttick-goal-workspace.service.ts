import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * 目标工作区 — 聚合目标、关联计划、任务与成果指标。
 */

export interface GoalWorkspacePlan {
  id: string;
  title: string;
  status: string;
  period_start: string;
  period_end: string;
  progress: { completed: number; total: number };
}

export interface GoalWorkspaceResult {
  mode: "unset" | "actions" | "milestones";
  current: number;
  target: number | null;
  unit: string;
  percent: number | null;
  ready: boolean;
}

export interface GoalWorkspaceGoal {
  id: string;
  title: string;
  description?: string;
  status: string;
  target_date?: string;
  result: GoalWorkspaceResult;
  plans: GoalWorkspacePlan[];
  task_count: number;
  completed_task_count: number;
}

export interface GoalWorkspaceSnapshot {
  workspace_version: number;
  goals: GoalWorkspaceGoal[];
}

export const WORKSPACE_VERSION = 1;

export class LightTickGoalWorkspaceService {
  constructor(private readonly repository: LightTickRepository) {}

  async get(owner: LightTickOwner): Promise<GoalWorkspaceSnapshot> {
    const goals = await this.repository.listGoals(owner);
    const plans = await this.repository.listPlans(owner);
    const tasks = await this.repository.listTasks(owner);

    const planById = new Map(plans.map(p => [p.id, p]));
    const goalById = new Map(goals.map(g => [g.id, g]));

    const workspaceGoals: GoalWorkspaceGoal[] = [];

    for (const goal of goals) {
      if (goal.status === "archived") continue;

      const goalPlans = plans.filter(p => p.goalId === goal.id);
      const goalTasks = tasks.filter(t => t.goalId === goal.id);

      const workspacePlans: GoalWorkspacePlan[] = goalPlans.map(p => {
        const planTasks = tasks.filter(t => t.planId === p.id);
        const completed = planTasks.filter(t => t.status === "completed").length;
        return {
          id: p.id,
          title: `计划 ${p.periodStart.slice(0, 10)}`,
          status: p.status,
          period_start: p.periodStart,
          period_end: p.periodEnd,
          progress: { completed, total: planTasks.length },
        };
      });

      const result = this.computeResult(goal, goalTasks);

      workspaceGoals.push({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        status: goal.status,
        target_date: goal.targetDate,
        result,
        plans: workspacePlans,
        task_count: goalTasks.length,
        completed_task_count: goalTasks.filter(t => t.status === "completed").length,
      });
    }

    return {
      workspace_version: WORKSPACE_VERSION,
      goals: workspaceGoals,
    };
  }

  async updateResult(owner: LightTickOwner, goalId: string, input: {
    mode: "actions" | "milestones" | "unset";
    target?: number;
    unit?: string;
    note?: string;
  }): Promise<GoalWorkspaceGoal> {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal not found.");
    }
    if (goal.status !== "active") {
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Goal must be active to update result.");
    }

    const resultMetric = {
      mode: input.mode,
      target: input.target,
      unit: input.unit ?? "",
    };

    const resultHistory = [
      ...((goal.constraints as any).result_history ?? []),
      {
        at: new Date().toISOString(),
        metric: resultMetric,
        note: input.note ?? "",
      },
    ];

    const updated = await this.repository.saveGoal(
      {
        ...goal,
        constraints: {
          ...goal.constraints,
          result_metric: resultMetric,
          result_history: resultHistory,
        },
      },
      {
        event: {
          aggregateType: "goal",
          aggregateId: goalId,
          eventType: "goal_result_updated",
          aggregateVersion: goal.version + 1,
          payload: resultMetric,
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        change: {
          aggregateType: "goal",
          aggregateId: goalId,
          entityType: "goal",
          entityId: goalId,
        },
      },
      goal.version,
    );

    const tasks = await this.repository.listTasks(owner).filter(t => t.goalId === goalId);
    return {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      target_date: updated.targetDate,
      result: this.computeResult(updated, tasks),
      plans: [],
      task_count: tasks.length,
      completed_task_count: tasks.filter(t => t.status === "completed").length,
    };
  }

  private computeResult(goal: any, tasks: any[]): GoalWorkspaceResult {
    const metric = (goal.constraints as any)?.result_metric ?? { mode: "unset" };
    const mode = metric.mode;
    const target = metric.target;
    let current = 0;

    if (mode === "actions") {
      current = tasks.filter(t => t.status === "completed").length;
    } else if (mode === "milestones") {
      const milestones = metric.milestones ?? [];
      current = milestones.filter((m: any) => m.completed).length;
    }

    const percent = target && target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : null;
    const ready = !!(target && current >= target);

    return { mode, current, target: target ?? null, unit: metric.unit ?? "", percent, ready };
  }
}
