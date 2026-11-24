import { reviewManualContinuation } from "./manual-continuation.ts";
import { resolveManualPlanSubject } from "./manual-plan-subjects.ts";
import { subjectIdForPlan } from "../planning/goal-subjects.ts";
import { assertDailyCapacity } from "../goal-context/confirmed-conditions.ts";
import { resolveGoalConditions } from "../goal-context/resolve-conditions.ts";
import { assertWeeklyPlanningCapacity } from "../planning/weekly-capacity.ts";
import { assertRoadmapPlacement } from "../planning/roadmap-placement.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskExecutionProgressData, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
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
  const executionProgress = taskExecutionProgressData(t.executionProgress);
  return {
    id: t.id,
    ...(t.lessonSource ? { lesson_source: t.lessonSource } : {}),
    ...(executionProgress ? { execution_progress: executionProgress } : {}),
    ...(typeof t.actualMinutes === "number" ? { actual_duration_minutes: t.actualMinutes } : {}),
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
    ...(t.learningTarget ? { learning_target: t.learningTarget } : {}),
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
    readonly source: "manual_native" | "learning_schedule" = "manual_native",
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
  async create(owner: LightTickOwner, key: string, input: ManualDraft, metadata: Record<string, unknown> = {}) {
    validateManualDraft(input);
    return this.operation(owner, key, this.source === "manual_native" ? "manual.create" : "learning.schedule.create", input, async () => {
      const now = this.clock().toISOString();
      let goal: LightTickGoalRow;
      if (input.goal_id) {
        goal = await this.goal(owner, input.goal_id);
        this.available(goal, input);
        if (input.stage_id) assertRoadmapPlacement(goal, input.stage_id, input.period_start, input.period_end);
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
      const draft = await resolveManualPlanSubject(this.repository, goal, input, review.replacements,
        this.source === "manual_native" && !metadata.next_week_advice_run_id);
      const plan: LightTickPlanRow = {
        ...owner,
        id: randomId("lighttick_plan"),
        goalId: goal.id,
        granularity: "week",
        source: this.source,
        status: "proposed",
        periodStart: input.period_start,
        periodEnd: input.period_end,
        proposal: { ...this.proposal(draft, review.source), ...metadata },
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
    return this.project(owner, plan, goal, tasks, profile?.timezone ?? "UTC");
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
    return Promise.all(plans
      .filter((p) => p.source === this.source)
      .map(async (p) => {
        const goal = byGoal.get(p.goalId);
        if (!goal)
          throw new ApplicationError(
            404,
            "LIGHTTICK_RESOURCE_NOT_FOUND",
            "Goal was not found.",
          );
        return this.project(owner, p, goal, tasks, profile?.timezone ?? "UTC");
      }));
  }
  private async project(
    owner: LightTickOwner,
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
      ...(typeof p.proposal.next_week_advice_run_id === "string" ? { next_week_advice_run_id: p.proposal.next_week_advice_run_id } : {}),
      daily_limits: p.status !== "proposed" && Array.isArray(p.proposal.confirmed_daily_limits) ? p.proposal.confirmed_daily_limits : assertDailyCapacity(await resolveGoalConditions(this.repository,owner,g),(p.proposal.draft as unknown as ManualDraft).period_start,(p.proposal.draft as unknown as ManualDraft).period_end,p.status === "active" ? [] : (p.proposal.draft as unknown as ManualDraft).tasks,tasks,new Set(((p.proposal.draft as unknown as ManualDraft).replace_tasks??[]).map(r=>r.id)),timezone,false),
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
      const goal = await this.goal(owner, p.goalId);
      const previous = p.proposal.draft as unknown as ManualDraft;
      const draft: ManualDraft = {
        ...input,
        ...(input.stage_id === undefined && previous.stage_id ? { goal_id: p.goalId, stage_id: previous.stage_id } : {}),
        ...(input.subject_id === undefined && previous.subject_id ? { goal_id: p.goalId, subject_id: previous.subject_id } : {}),
      };
      this.available(goal, draft);
      if (draft.stage_id) assertRoadmapPlacement(goal, draft.stage_id, draft.period_start, draft.period_end);
      const review = await reviewManualContinuation(this.repository, owner, goal, draft, await this.repository.listTasks(owner), (await this.repository.getProfile(owner))?.timezone ?? "UTC");
      const scoped = await resolveManualPlanSubject(this.repository, goal, draft, review.replacements, !p.proposal.next_week_advice_run_id);
      await this.repository.savePlan(
        {
          ...p,
          periodStart: input.period_start,
          periodEnd: input.period_end,
          proposal: { ...this.proposal(scoped, review.source),
            ...(typeof p.proposal.next_week_advice_run_id === "string" ? { next_week_advice_run_id: p.proposal.next_week_advice_run_id } : {}),
          },
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
    validate?: (plan: LightTickPlanRow, goal: LightTickGoalRow, draft: ManualDraft, tasks: LightTickTaskRow[], timezone: string) => Promise<void>,
  ) {
    return this.operation(
      owner,
      key,
      (this.source === "manual_native" ? "manual.confirm:" : "learning.schedule.confirm:") + id,
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
        if (d.stage_id) assertRoadmapPlacement(g, d.stage_id, d.period_start, d.period_end);
        const allTasks=await this.repository.listTasks(owner);
        const timezone=(await this.repository.getProfile(owner))?.timezone??"UTC";
        await validate?.(p, g, d, allTasks, timezone);
        const review=await reviewManualContinuation(this.repository,owner,g,d,allTasks,timezone,p.id);
        const fromNextWeekAdvice = typeof p.proposal.next_week_advice_run_id === "string";
        const scoped = await resolveManualPlanSubject(this.repository, g, d, review.replacements,
          this.source === "manual_native" && !fromNextWeekAdvice);
        if (scoped.subject_id !== d.subject_id) invalid("Review the subject of the original work before confirming this draft.");
        const newTaskIds = new Map(d.tasks.map(action => [action.id, randomId("lighttick_task")]));
        const carryTasks = fromNextWeekAdvice ? d.tasks.filter(action => action.source_task_id) : [];
        const carryIds = new Map(carryTasks.map(action => [action.source_task_id!, newTaskIds.get(action.id)!]));
        if (fromNextWeekAdvice && (carryIds.size !== carryTasks.length || carryIds.size !== review.replacements.length ||
          review.replacements.some(task => task.lessonSource || !task.executionProgress?.outcome || !carryIds.has(task.id)))) {
          invalid("Every transferred action must have one reviewed ordinary task with saved progress.");
        }
        const retired=new Set(review.replacements.map(t=>t.id));
        await assertWeeklyPlanningCapacity(this.repository, owner, d.tasks.map(action => ({
          scheduledFor: action.scheduled_for ?? undefined, estimatedMinutes: action.estimated_minutes,
          goalId: g.id, ...(d.subject_id ? { subjectId: d.subject_id } : {}), sourceTaskId: action.source_task_id,
        })), { existing: allTasks, replacing: retired, timezone, now: new Date(now), ...(d.resume_goal ? { resumingGoalId: g.id } : {}) });
        const existing=allTasks.filter(t=>t.goalId===g.id&&t.status!=="cancelled"&&!retired.has(t.id));
        const planSubjects = new Map((await this.repository.listPlans(owner, g.id)).map(plan => [plan.id, subjectIdForPlan(plan)]));
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
                planSubjects.get(t.planId) === d.subject_id &&
                identity(t.title) === identity(a.title) &&
                date(t) === a.scheduled_for,
            )
          )
            throw new ApplicationError(
              409,
              "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
              "An existing action matches this title and date. Existing arrangements were retained.",
            );
        // M8: fixed-source learning commitments. Re-verify the published route,
        // lesson body and pinned version; gate to a single main learning goal until
        // shared capacity is verified; dedupe the same lesson/purpose/date across sessions.
        const learningActions = d.tasks.filter(a => a.learning_target);
        if (learningActions.length) {
          if (allTasks.some(t => t.learningTarget && t.goalId !== g.id && !["completed", "cancelled", "skipped"].includes(t.status)))
            throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
              "Another goal already holds an active learning arrangement; shared learning capacity is not verified yet.");
          for (const a of learningActions) {
            const lt = a.learning_target!;
            if (!a.scheduled_for || a.estimated_minutes === null)
              invalid("A learning commitment needs a reviewed date and a confirmed duration.");
            if (existing.some(t => t.learningTarget && t.learningTarget.plan_id === lt.plan_id &&
              t.learningTarget.lesson_no === lt.lesson_no && t.learningTarget.purpose === lt.purpose && date(t) === a.scheduled_for))
              throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
                "This lesson already has an arrangement on that date. Existing arrangements were retained.");
            const route = await this.repository.learningRoutes.getLearningRoute(owner, lt.plan_id);
            if (!route?.publishedVersion || route.publishedVersion !== lt.route_version)
              throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
                "The course route is unpublished or changed version. Review the current route before confirming.");
            const routeVersion = await this.repository.learningRoutes.getLearningRouteVersion(owner, lt.plan_id, lt.route_version);
            if (!routeVersion?.document.lessons.some(l => l.number === lt.lesson_no))
              invalid("The lesson is not part of the reviewed route version.");
            const link = (await this.repository.learningRoutes.listRouteLessonLinks(owner, lt.plan_id)).find(l => l.number === lt.lesson_no);
            if (!link || link.lessonId !== lt.lesson_id)
              invalid("The lesson body is not published for this route lesson.");
            const lesson = await this.repository.getNativeLesson(owner, lt.lesson_id);
            if (!lesson || lesson.archived || !lesson.publishedVersion)
              invalid("The lesson body is not published.");
            if (!(await this.repository.getLessonPublication(owner, lt.lesson_id, lt.content_version)))
              invalid("The pinned content version is not published.");
          }
        }
        const budgets = new Map<string, number>();
        const reserved = existing.filter((task) => task.status === "completed" ||
          (task.status === "pending" || task.status === "in_progress") &&
          !taskAwaitingExternalInput(task) && !taskHasTransferredRemainingWork(task));
        for (const t of [
          ...reserved.map((t) => ({
            scheduled_for: date(t),
            estimated_minutes: t.status === "completed" ? t.actualMinutes ?? t.estimatedMinutes : taskRemainingEstimate(t),
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
        for (const old of review.replacements) {
          const childId = carryIds.get(old.id);
          const next = { ...old, status: "cancelled", updatedAt: now,
            ...(childId ? { executionProgress: { ...old.executionProgress, transferredToTaskId: childId } } : {}) };
          await this.repository.saveTask(next,
            this.write(owner, "task", old.id, old.version + 1, childId ? "task_remaining_transferred" : "task_replaced", now, {
              status: "cancelled", replacement_plan_id: p.id, ...(childId ? { transferred_to_task_id: childId,
                execution_progress: taskExecutionProgressData(next.executionProgress) } : {}),
            }), old.version);
        }
        // 目标标题属于目标本身，计划标题只属于本次计划（保存在 proposal.draft.title）。
        // 确认计划时不得用计划标题覆盖目标标题，否则每确认一个周计划都会重命名目标，
        // 且目标将无法按用户输入的原标题检索。
        await this.repository.saveGoal(
          {
            ...g,
            constraints: {
              ...g.constraints,
              ...(this.source === "manual_native" && !fromNextWeekAdvice && !d.subject_id ? { completion_criteria: d.completion_criteria } : {}),
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
          const sourceTask = review.replacements.find(task => task.id === a.source_task_id) ??
            (this.source === "manual_native" && !fromNextWeekAdvice && review.replacements.length === 1 ? review.replacements[0] : undefined);
          const carriedFrom = fromNextWeekAdvice && sourceTask ? sourceTask.id : undefined;
          const t: LightTickTaskRow = {
            ...owner,
            id: newTaskIds.get(a.id)!,
            goalId: g.id,
            planId: p.id,
            ...(sourceTask ? {lineageId:sourceTask.lineageId??sourceTask.id} : {}),
            ...(carriedFrom ? { executionProgress: { splitFromTaskId: carriedFrom } } : {}),
            title: a.title.trim(),
            status: "pending",
            priority: d.tasks.length - position,
            estimatedMinutes: a.estimated_minutes,
            scheduledFor: a.scheduled_for ?? undefined,
            ...(this.source === "learning_schedule" && a.lesson_source ? { lessonSource: a.lesson_source } : {}),
            completionCriteria: a.completion_criteria || undefined,
            notes: a.guidance || undefined,
            ...(a.learning_target ? { learningTarget: a.learning_target } : {}),
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await this.repository.saveTask(
            t,
            this.write(owner, "task", t.id, 1, carriedFrom ? "task_remaining_created" : "task_materialized", now, {
              plan_id: p.id,
              manual_action_id: a.id,
              ...(carriedFrom ? { split_from_task_id: carriedFrom, execution_progress: taskExecutionProgressData(t.executionProgress) } : {}),
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
      ...(input.stage_id ? { stage_id: input.stage_id } : {}),
      ...(input.subject_id ? { subject_id: input.subject_id } : {}),
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
        ...(a.learning_target ? { learningTarget: a.learning_target } : {}),
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
    if (!p || p.source !== this.source || p.proposal.manual_schema !== 1)
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
