import { reviewManualContinuation } from "./manual-continuation.ts";
import { assertDailyCapacity } from "../goal-context/confirmed-conditions.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import type {
  LightTickRepository,
  LightTickAtomicWrite,
} from "../lighttick.repository.ts";
import type {
  LightTickOwner,
  LightTickGoalRow,
  LightTickPlanRow,
  LightTickTaskRow,
} from "../lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
export function manualTaskData(t: LightTickTaskRow, timezone = "UTC") {
  return {
    id: t.id,
    goal_id: t.goalId,
    plan_id: t.planId,
    title: t.title,
    status: t.status,
    scheduled_date: t.scheduledFor
      ? t.scheduledFor.length === 10
        ? t.scheduledFor
        : businessDateAt(new Date(t.scheduledFor), timezone)
      : null,
    estimated_duration_minutes: t.estimatedMinutes,
    completion_criteria: t.completionCriteria ?? "",
    notes: t.notes ?? "",
    completed_at: t.completedAt ?? null,
    version: t.version,
  };
}
import {
  validateManualDraft,
  invalid,
  type ManualDraft,
} from "./manual-planning.types.ts";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Purely manual planning in the existing goal/plan/task domain. No provider or Grow dependency. */
export class ManualPlanningService {
  constructor(
    readonly repository: LightTickRepository,
    readonly clock = () => new Date(),
    readonly assertActive: () => Promise<void> = async () => {},
  ) {}
  async operation<T>(
    owner: LightTickOwner,
    key: string,
    action: string,
    payload: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      throw new ApplicationError(
        400,
        "REQ_FIELD_REQUIRED",
        "Idempotency-Key is required.",
      );
    const hash = sha256(canonical({ action, payload }));
    return this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      await this.assertActive();
      const previous = await this.repository.getOperation(owner, key);
      if (previous) {
        if (previous.payloadHash !== hash || previous.action !== action)
          throw new ApplicationError(
            409,
            "LIGHTTICK_IDEMPOTENCY_MISMATCH",
            "The request key belongs to another request.",
          );
        return structuredClone(previous.resultPayload) as T;
      }
      const result = await execute(),
        now = this.clock().toISOString();
      const stored = await this.repository.saveOperation({
        ...owner,
        operationId: key,
        deviceId: "native-manual",
        payloadHash: hash,
        entityType: "manual_plan",
        entityId: action,
        action,
        requestPayload: {},
        resultPayload: structuredClone(result) as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      if (stored.payloadHash !== hash || stored.action !== action)
        throw new ApplicationError(
          409,
          "LIGHTTICK_IDEMPOTENCY_MISMATCH",
          "A concurrent request used this operation key.",
        );
      return structuredClone(stored.resultPayload) as T;
    });
  }
  async create(owner: LightTickOwner, key: string, input: ManualDraft) {
    validateManualDraft(input);
    return this.operation(owner, key, "manual.create", input, async () => {
      const now = this.clock().toISOString();
      let goal: LightTickGoalRow;
      if (input.goal_id) {
        goal = await this.goal(owner, input.goal_id);
        this.available(goal, input);
      } else {
        goal = {
          ...owner,
          id: randomId("lighttick_goal"),
          title: input.title.trim(),
          status: "draft",
          constraints: {},
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await this.repository.saveGoal(
          goal,
          this.write(owner, "goal", goal.id, 1, "manual_goal_drafted", now, {
            status: "draft",
          }),
        );
      }
      const review = await reviewManualContinuation(this.repository,owner,goal,input,await this.repository.listTasks(owner),(await this.repository.getProfile(owner))?.timezone??"UTC");
      const plan: LightTickPlanRow = {
        ...owner,
        id: randomId("lighttick_plan"),
        goalId: goal.id,
        granularity: "week",
        source: "manual_native",
        status: "proposed",
        periodStart: input.period_start,
        periodEnd: input.period_end,
        proposal: this.proposal(input, review.source),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.savePlan(
        plan,
        this.write(owner, "plan", plan.id, 1, "manual_plan_drafted", now, {
          status: "proposed",
        }),
      );
      return this.get(owner, plan.id);
    });
  }
  async get(owner: LightTickOwner, id: string) {
    const plan = await this.plan(owner, id);
    // Mutation callers share one PostgreSQL transaction connection.
    const goal = await this.goal(owner, plan.goalId);
    const tasks = await this.repository.listTasks(owner);
    const profile = await this.repository.getProfile(owner);
    return this.project(plan, goal, tasks, profile?.timezone ?? "UTC");
  }
  async list(owner: LightTickOwner) {
    // Read each owner collection once; a long history must not fan out per plan.
    const [plans, goals, tasks, profile] = await Promise.all([
      this.repository.listPlans(owner),
      this.repository.listGoals(owner),
      this.repository.listTasks(owner),
      this.repository.getProfile(owner),
    ]);
    const byGoal = new Map(goals.map((g) => [g.id, g]));
    return plans
      .filter((p) => p.source === "manual_native")
      .map((p) => {
        const goal = byGoal.get(p.goalId);
        if (!goal)
          throw new ApplicationError(
            404,
            "LIGHTTICK_RESOURCE_NOT_FOUND",
            "Goal was not found.",
          );
        return this.project(p, goal, tasks, profile?.timezone ?? "UTC");
      });
  }
  private project(
    p: LightTickPlanRow,
    g: LightTickGoalRow,
    tasks: LightTickTaskRow[],
    timezone: string,
  ) {
    return {
      id: p.id,
      goal_id: g.id,
      goal_version: g.version,
      version: p.version,
      status: p.status,
      draft: p.proposal.draft as unknown as ManualDraft,
      ...(p.proposal.source_reflection_snapshot ? {source_reflection:p.proposal.source_reflection_snapshot} : {}),
      daily_limits: p.status !== "proposed" && Array.isArray(p.proposal.confirmed_daily_limits) ? p.proposal.confirmed_daily_limits : assertDailyCapacity(g,(p.proposal.draft as unknown as ManualDraft).period_start,(p.proposal.draft as unknown as ManualDraft).period_end,p.status === "active" ? [] : (p.proposal.draft as unknown as ManualDraft).tasks,tasks,new Set(((p.proposal.draft as unknown as ManualDraft).replace_tasks??[]).map(r=>r.id)),timezone,false),
      replaced_tasks: tasks.filter(t=>((p.proposal.draft as unknown as ManualDraft).replace_tasks??[]).some(r=>r.id===t.id)).map(t=>manualTaskData(t,timezone)),
      preserved_tasks: tasks
        .filter((t) => t.goalId === g.id && t.planId !== p.id && !((p.proposal.draft as unknown as ManualDraft).replace_tasks??[]).some(r=>r.id===t.id))
        .map((t) => manualTaskData(t, timezone)),
      tasks: tasks
        .filter((t) => t.planId === p.id)
        .map((t) => manualTaskData(t, timezone)),
    };
  }
  async update(
    owner: LightTickOwner,
    id: string,
    key: string,
    input: ManualDraft & { base_version: number },
  ) {
    validateManualDraft(input);
    return this.operation(owner, key, `manual.edit:${id}`, input, async () => {
      const p = await this.plan(owner, id);
      this.proposed(p, input.base_version);
      if ((input.goal_id ?? p.goalId) !== p.goalId)
        invalid("A draft cannot change owner goal.");
      const goal = await this.goal(owner,p.goalId);this.available(goal,input);
      const review = await reviewManualContinuation(this.repository,owner,goal,input,await this.repository.listTasks(owner),(await this.repository.getProfile(owner))?.timezone??"UTC");
      await this.repository.savePlan(
        {
          ...p,
          periodStart: input.period_start,
          periodEnd: input.period_end,
          proposal: this.proposal(input, review.source),
          updatedAt: this.clock().toISOString(),
        },
        this.write(
          owner,
          "plan",
          id,
          p.version + 1,
          "manual_plan_edited",
          this.clock().toISOString(),
          { status: "proposed" },
        ),
        p.version,
      );
      return this.get(owner, id);
    });
  }
  async confirm(
    owner: LightTickOwner,
    id: string,
    key: string,
    input: { base_version: number; goal_base_version: number },
  ) {
    return this.operation(
      owner,
      key,
      `manual.confirm:${id}`,
      input,
      async () => {
        const p = await this.plan(owner, id);
        this.proposed(p, input.base_version);
        const g = await this.goal(owner, p.goalId);
        if (g.version !== input.goal_base_version)
          throw new ApplicationError(
            409,
            "LIGHTTICK_VERSION_CONFLICT",
            "Goal changed. Review the current arrangements.",
          );
        const d = validateManualDraft(
            p.proposal.draft as unknown as ManualDraft,
          ),
          now = this.clock().toISOString();
        this.available(g,d);
        const allTasks=await this.repository.listTasks(owner);
        const timezone=(await this.repository.getProfile(owner))?.timezone??"UTC";
        const review=await reviewManualContinuation(this.repository,owner,g,d,allTasks,timezone,p.id);
        const retired=new Set(review.replacements.map(t=>t.id));
        const existing=allTasks.filter(t=>t.goalId===g.id&&t.status!=="cancelled"&&!retired.has(t.id));
        const identity = (title: string) =>
          title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
        const date = (t: LightTickTaskRow) =>
          t.scheduledFor
            ? t.scheduledFor.length === 10
              ? t.scheduledFor
              : businessDateAt(new Date(t.scheduledFor), timezone)
            : null;
        for (const a of d.tasks)
          if (
            existing.some(
              (t) =>
                identity(t.title) === identity(a.title) &&
                date(t) === a.scheduled_for,
            )
          )
            throw new ApplicationError(
              409,
              "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
              "An existing action matches this title and date. Existing arrangements were retained.",
            );
        const budgets = new Map<string, number>();
        for (const t of [
          ...existing.map((t) => ({
            scheduled_for: date(t),
            estimated_minutes: t.estimatedMinutes,
          })),
          ...d.tasks,
        ])
          if (t.scheduled_for) {
            const n =
              (budgets.get(t.scheduled_for) ?? 0) + (t.estimated_minutes ?? 0);
            if (n > 1440)
              invalid("Existing and new actions exceed daily capacity.");
            budgets.set(t.scheduled_for, n);
          }
        for(const old of review.replacements)await this.repository.saveTask({...old,status:"cancelled",updatedAt:now},this.write(owner,"task",old.id,old.version+1,"task_replaced",now,{status:"cancelled",replacement_plan_id:p.id}),old.version);
        await this.repository.saveGoal(
          {
            ...g,
            title: d.title.trim(),
            constraints: {
              ...g.constraints,
              completion_criteria: d.completion_criteria,
            },
            status: g.status === "draft" || d.resume_goal ? "active" : g.status,
            updatedAt: now,
          },
          this.write(
            owner,
            "goal",
            g.id,
            g.version + 1,
            "manual_goal_confirmed",
            now,
            {
              title: d.title,
              status: g.status === "draft" || d.resume_goal ? "active" : g.status,
            },
          ),
          g.version,
        );
        await this.repository.savePlan(
          { ...p, status: "active", proposal:{...p.proposal,confirmed_daily_limits:review.dailyLimits}, updatedAt: now },
          this.write(
            owner,
            "plan",
            p.id,
            p.version + 1,
            "plan_confirmed",
            now,
            { status: "active" },
          ),
          p.version,
        );
        for (const [position, a] of d.tasks.entries()) {
          const sourceTask=review.replacements.find(t=>t.id===a.source_task_id)??(review.replacements.length===1?review.replacements[0]:undefined);
          const t: LightTickTaskRow = {
            ...owner,
            id: randomId("lighttick_task"),
            goalId: g.id,
            planId: p.id,
            ...(sourceTask ? {lineageId:sourceTask.lineageId??sourceTask.id} : {}),
            title: a.title.trim(),
            status: "pending",
            priority: d.tasks.length - position,
            estimatedMinutes: a.estimated_minutes,
            scheduledFor: a.scheduled_for ?? undefined,
            completionCriteria: a.completion_criteria || undefined,
            notes: a.guidance || undefined,
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await this.repository.saveTask(
            t,
            this.write(owner, "task", t.id, 1, "task_materialized", now, {
              plan_id: p.id,
              manual_action_id: a.id,
              ...(sourceTask ? {source_task_id:sourceTask.id} : {}),
              ...(d.source_reflection_id ? {source_reflection_id:d.source_reflection_id,source_reflection_version:d.source_reflection_version} : {}),
            }),
          );
        }
        return this.get(owner, id);
      },
    );
  }
  private proposal(input: ManualDraft, source?: unknown) {
    return {
      manual_schema: 1,
      ...(source ? {source_reflection_snapshot:source} : {}),
      draft: validateManualDraft(input),
      tasks: input.tasks.map((a) => ({
        title: a.title,
        estimatedMinutes: a.estimated_minutes,
        ...(a.scheduled_for ? { scheduledFor: a.scheduled_for } : {}),
        ...(a.completion_criteria
          ? { completionCriteria: a.completion_criteria }
          : {}),
        ...(a.guidance ? { guidance: { purpose: a.guidance } } : {}),
      })),
    };
  }
  private available(g: LightTickGoalRow, draft?: ManualDraft) {
    if (!["draft", "active"].includes(g.status) && !(draft?.resume_goal && ["paused","recovering"].includes(g.status)))
      throw new ApplicationError(
        409,
        "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
        "This goal is paused or ended.",
      );
  }
  private proposed(p: LightTickPlanRow, v: number) {
    if (p.status !== "proposed" || p.version !== v)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "The plan changed. Review before confirming.",
      );
  }
  private async plan(o: LightTickOwner, id: string) {
    const p = await this.repository.getPlan(o, id);
    if (!p || p.source !== "manual_native" || p.proposal.manual_schema !== 1)
      throw new ApplicationError(
        404,
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "Manual plan was not found.",
      );
    return p;
  }
  private async goal(o: LightTickOwner, id: string) {
    const g = await this.repository.getGoal(o, id);
    if (!g)
      throw new ApplicationError(
        404,
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "Goal was not found.",
      );
    return g;
  }
  write(
    o: LightTickOwner,
    type: string,
    id: string,
    version: number,
    kind: string,
    now: string,
    payload: Record<string, unknown>,
  ): LightTickAtomicWrite {
    return {
      event: {
        ...o,
        id: randomId("lighttick_event"),
        aggregateType: type,
        aggregateId: id,
        eventType: kind,
        aggregateVersion: version,
        payload,
        occurredAt: now,
        createdAt: now,
      },
      change: {
        ...o,
        entityType: type,
        entityId: id,
        entityVersion: version,
        operation: "upsert",
        snapshot: payload,
        changedAt: now,
      },
    };
  }
}
