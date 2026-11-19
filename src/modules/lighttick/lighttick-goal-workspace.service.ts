import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickTaskRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

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

interface GoalResultMetric {
  mode: GoalWorkspaceResult["mode"];
  target?: number;
  unit?: string;
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
    milestones?: unknown;
  }): Promise<GoalWorkspaceGoal> {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal not found.");
    }
    if (goal.status !== "active") {
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Goal must be active to update result.");
    }

    const previous = goal.constraints.result_metric as GoalResultMetric | undefined;
    const milestones = input.milestones === undefined ? previous?.milestones : normalizeMilestones(input.milestones);
    if (input.mode === "milestones" && !milestones?.length)
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "At least one milestone is required.");

    const resultMetric: GoalResultMetric = {
      mode: input.mode,
      target: input.target ?? (input.mode === "milestones" ? milestones?.length : undefined),
      unit: input.unit ?? "",
      milestones,
    };

    const timestamp = new Date().toISOString();
    const version = goal.version + 1;
    const history = goal.constraints.result_history;
    const resultHistory = [
      ...(Array.isArray(history) ? history : []),
      {
        at: timestamp,
        metric: resultMetric,
        note: input.note ?? "",
      },
    ];

    const tasks = (await this.repository.listTasks(owner)).filter(task => task.goalId === goalId);
    const updated = await this.repository.saveGoal(
      {
        ...goal,
        updatedAt: timestamp,
        constraints: {
          ...goal.constraints,
          result_metric: resultMetric,
          result_history: resultHistory,
        },
      },
      {
        event: {
          ...owner,
          id: randomId("lighttick_event"),
          aggregateType: "goal",
          aggregateId: goalId,
          eventType: "goal_result_updated",
          aggregateVersion: version,
          payload: { ...resultMetric },
          occurredAt: timestamp,
          createdAt: timestamp,
        },
        change: {
          ...owner,
          entityType: "goal",
          entityId: goalId,
          entityVersion: version,
          operation: "upsert",
          snapshot: { id: goalId, title: goal.title, status: goal.status, version },
          changedAt: timestamp,
        },
      },
      goal.version,
    );

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

  private computeResult(goal: LightTickGoalRow, tasks: LightTickTaskRow[]): GoalWorkspaceResult {
    const metric = goal.constraints.result_metric as GoalResultMetric | undefined;
    const mode = metric?.mode ?? "unset";
    const milestones = Array.isArray(metric?.milestones) ? metric.milestones : [];
    const target = metric?.target ?? (mode === "milestones" && milestones.length ? milestones.length : null);
    let current = 0;

    if (mode === "actions") {
      current = tasks.filter(t => t.status === "completed").length;
    } else if (mode === "milestones") {
      current = milestones.filter(m => m?.completed === true).length;
    }

    const percent = target && target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : null;
    const ready = !!(target && current >= target);

    return {
      mode,
      current,
      target: target ?? null,
      unit: metric?.unit ?? "",
      percent,
      ready,
      milestones,
    };
  }
}

const MILESTONE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function normalizeMilestones(input: unknown): GoalWorkspaceMilestone[] {
  if (!Array.isArray(input) || input.length > 50) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "milestones must be an array of at most 50 items.");
  }
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(key => !["id", "title", "completed", "completed_at"].includes(key)))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Invalid milestone object.");
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
    const completed = item.completed;
    const completedAt = item.completed_at;
    if (typeof completed !== "boolean" || (completedAt !== undefined &&
        (typeof completedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(completedAt) ||
          !Number.isFinite(Date.parse(completedAt)))))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Invalid milestone completion.");
    // 未完成却带完成时间会让进度和时间线互相矛盾，这里统一抹掉。
    return {
      id,
      title,
      completed,
      ...(completed && completedAt ? { completed_at: completedAt } : {}),
    };
  });
}
