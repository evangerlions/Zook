import { canReadNativeLearning } from "../modules/lighttick/learning/native-learning-access.ts";
import { taskScheduledDate } from "../modules/lighttick/lighttick-today.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner, LightTickTaskRow } from "../modules/lighttick/lighttick.types.ts";
import { subjectIdForPlan } from "../modules/lighttick/planning/goal-subjects.ts";
import { planSubjectData } from "../modules/lighttick/planning/subject-plan-projection.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { planData, taskData, taskDetailData } from "./lighttick-route-mappers.ts";
import { recordFact, response } from "./lighttick-v1-http.ts";

const PREFIX = "/api/v1/lighttick/";

export async function handlePlanningExecutionReadRequest(
  context: BackendRouteContext,
  runtime: LightTickRuntime,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "GET") return undefined;
  if (request.path === `${PREFIX}plans`) {
    const goalId = request.query?.goal_id?.trim() || undefined;
    const plans = await runtime.plans.list(owner, goalId);
    return response(context, request, { items: plans.map(plan => planData(plan)), next_cursor: null });
  }
  const planMatch = request.path.match(/^\/api\/v1\/lighttick\/plans\/([^/]+)(\/tasks)?$/);
  if (planMatch) {
    const plan = await runtime.repository.getPlan(owner, planMatch[1]!);
    if (!plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
    const tasks = await runtime.repository.listTasks(owner, plan.id);
    if (planMatch[2]) {
      return response(context, request, { items: await Promise.all(tasks.map(async task =>
        taskData(task, await runtime.repository.listTaskSteps(owner, task.id)))), next_cursor: null });
    }
    return response(context, request, planData(plan, await Promise.all(tasks.map(async task =>
      ({ ...task, steps: await runtime.repository.listTaskSteps(owner, task.id) })))));
  }
  const taskDetailMatch = request.path.match(/^\/api\/v1\/lighttick\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})$/);
  if (taskDetailMatch) {
    const repository = runtime.repository;
    const detail = await repository.transaction(owner, async () => {
      const task = await repository.getTask(owner, taskDetailMatch[1]!);
      const authority = task?.lessonSource ? await repository.getLearningAuthority(owner) : undefined;
      if (!task || (task.lessonSource && !canReadNativeLearning(authority)))
        throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
      const steps = await repository.listTaskSteps(owner, task.id);
      const timezone = (await repository.getProfile(owner))?.timezone ?? "UTC";
      const plan = await repository.getPlan(owner, task.planId);
      const subject = plan && subjectIdForPlan(plan) && planSubjectData(plan, await repository.getGoal(owner, task.goalId));
      return { ...taskDetailData(task, steps, timezone), ...(subject || {}) };
    });
    const result = response(context, request, detail);
    result.headers = { ...result.headers, "Cache-Control": "no-store" };
    return result;
  }
  if (request.path === `${PREFIX}today`) {
    const today = await runtime.today.get(owner);
    const renderTask = (task: LightTickTaskRow) => {
      const continuedFrom = today.learningContinuedFrom?.get(task.id);
      return { ...taskData(task, today.taskSteps.filter(step => step.taskId === task.id)),
        ...today.planSubjects?.get(task.planId),
        ...(continuedFrom ? { learning_continued_from: continuedFrom } : {}) };
    };
    await recordFact(runtime, request, owner.userId, "lighttick_return_observed", `today:${today.businessDate}`, "today",
      { business_date: today.businessDate, result: "browsed" });
    return response(context, request, { business_date: today.businessDate,
      timezone: today.timezone, primary_task: today.primaryTask ? await renderTask(today.primaryTask) : undefined,
      tasks: await Promise.all(today.executableTasks.map(renderTask)), completed_tasks: await Promise.all(today.completedTasks.map(renderTask)),
      task_progress_supported: true, unknown_remaining_task_count: today.unknownRemainingTaskCount,
      waiting_tasks: today.waitingTasks.map(renderTask), continuation_tasks: today.continuationTasks.map(renderTask),
      ...(getHeader(request.headers, "x-lighttick-task-schema") === "2" && today.missedTasks?.length ? {
        missed_tasks: today.missedTasks.map(task => ({ ...renderTask(task), scheduled_date: taskScheduledDate(task, today.timezone) })),
      } : {}),
      ...(today.cycleHandoffs ? { cycle_handoffs: today.cycleHandoffs.map(handoff => ({
        goal_id: handoff.goalId, goal_title: handoff.goalTitle, plan_id: handoff.planId,
        period_start: handoff.periodStart, period_end: handoff.periodEnd, state: handoff.state,
        ...(handoff.subjectId ? { subject_id: handoff.subjectId, subject_title: handoff.subjectTitle } : {}),
        ...(handoff.nextDraftId ? { next_draft_id: handoff.nextDraftId } : {}),
        ...(handoff.planningKind ? { planning_kind: handoff.planningKind } : {}),
        ...(handoff.nextPlanningSessionId ? { next_planning_session_id: handoff.nextPlanningSessionId } : {}),
      })) } : {}),
      ...(today.learningNeedsAdjustment?.length ? { learning_needs_adjustment: today.learningNeedsAdjustment.map(({ task, reason }) =>
        ({ ...renderTask(task), learning_adjustment_reason: reason })) } : {}),
      remaining_estimated_minutes: today.remainingEstimatedMinutes, plan_b_available: today.planBAvailable,
      empty_state_action: today.emptyState === "goal_paused" ? "resume_goal" : today.emptyState === "no_active_plan" ? "generate_plan" : today.emptyState === "no_tasks_today" ? "rest" : "none",
      snapshot_version: today.snapshotVersion });
  }
  return undefined;
}
