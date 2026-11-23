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

export interface GoalWorkspaceMilestone {
  id: string;
  title: string;
  completed: boolean;
  completed_at?: string;
}

export interface GoalWorkspaceResult {
  mode: "unset" | "actions" | "milestones";
  current: number;
  target: number | null;
  unit: string;
  percent: number | null;
  ready: boolean;
  milestones?: GoalWorkspaceMilestone[];
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
    milestones?: GoalWorkspaceMilestone[];
  }): Promise<GoalWorkspaceGoal> {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal not found.");
    }
    if (goal.status !== "active") {
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Goal must be active to update result.");
    }

    // 里程碑由用户自己定义，条数即分母；否则进度只会停在「0 / ?」。
    const milestones = input.milestones === undefined ? undefined : normalizeMilestones(input.milestones);
    if (input.mode === "milestones" && milestones === undefined) {
      const existing = (goal.constraints as any)?.result_metric?.milestones;
      if (!Array.isArray(existing) || existing.length === 0) {
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "milestones must be provided for milestones mode.");
      }
    }

    const resultMetric: Record<string, unknown> = {
      mode: input.mode,
      target: input.mode === "milestones" && input.target === undefined && milestones
        ? milestones.length
        : input.target,
      unit: input.unit ?? "",
    };
    if (milestones !== undefined) resultMetric.milestones = milestones;
    else {
      // 切到别的衡量方式时保留已定义的里程碑，否则切回来就只剩一个空列表。
      const existing = (goal.constraints as any)?.result_metric?.milestones;
      if (Array.isArray(existing) && existing.length > 0) resultMetric.milestones = existing;
    }

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

    // listTasks 返回 Promise，直接 .filter 会抛 TypeError —— 这条路径此前从未真正跑通。
    const tasks = (await this.repository.listTasks(owner)).filter(t => t.goalId === goalId);
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
    const milestones: GoalWorkspaceMilestone[] = Array.isArray(metric.milestones)
      ? metric.milestones.map((item: any) => ({
          id: String(item.id),
          title: String(item.title),
          completed: item.completed === true,
          ...(item.completed_at ? { completed_at: String(item.completed_at) } : {}),
        }))
      : [];
    const target = mode === "milestones" && metric.target === undefined
      ? milestones.length
      : metric.target;
    let current = 0;

    if (mode === "actions") {
      current = tasks.filter(t => t.status === "completed").length;
    } else if (mode === "milestones") {
      current = milestones.filter(m => m.completed).length;
    }

    const percent = target && target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : null;
    const ready = !!(target && current >= target);

    return {
      mode,
      current,
      target: target ?? null,
      unit: metric.unit ?? "",
      percent,
      ready,
      milestones,
    };
  }
}

const MILESTONE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeMilestones(input: GoalWorkspaceMilestone[]): GoalWorkspaceMilestone[] {
  if (!Array.isArray(input) || input.length > 50) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "milestones must be an array of at most 50 items.");
  }
  const seen = new Set<string>();
  return input.map((item, index) => {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    if (!MILESTONE_ID.test(id)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", `milestones[${index}].id is invalid.`);
    }
    if (!title || title.length > 200) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", `milestones[${index}].title is invalid.`);
    }
    if (seen.has(id)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", `milestones[${index}].id is duplicated.`);
    }
    seen.add(id);
    const completed = item.completed === true;
    const completedAt = typeof item.completed_at === "string" && !Number.isNaN(Date.parse(item.completed_at))
      ? item.completed_at
      : undefined;
    // 未完成却带完成时间会让进度和时间线互相矛盾，这里统一抹掉。
    return {
      id,
      title,
      completed,
      ...(completed && completedAt ? { completed_at: completedAt } : {}),
    };
  });
}
