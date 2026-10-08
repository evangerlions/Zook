import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { aggregateExecutionFacts } from "../lighttick-execution-facts.ts";

/** Builds a small owner-scoped snapshot. Private notes and raw coach text are intentionally excluded. */
export async function assembleLightTickContext(repository: LightTickRepository, owner: LightTickOwner,
  input: Record<string, unknown>) {
  const goalId = typeof input.goal_id === "string" ? input.goal_id : undefined;
  const planId = typeof input.plan_id === "string" ? input.plan_id : undefined;
  const goal = goalId ? await repository.getGoal(owner, goalId) : undefined;
  const plan = planId ? await repository.getPlan(owner, planId) : undefined;
  if (goalId && !goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
  if (planId && !plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
  const tasks = plan ? await repository.listTasks(owner, plan.id) : [];
  const reviewId = typeof input.review_id === "string" ? input.review_id : undefined;
  const review = reviewId ? (await repository.listReviews(owner)).find(item => item.id === reviewId) : undefined;
  if (reviewId && !review) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Review was not found.");
  if ((goalId && plan && plan.goalId !== goalId) || (review && goalId && review.goalId !== goalId) ||
    (review && plan && review.goalId !== plan.goalId))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Context resources must belong to the same goal.");
  return {
    request: input,
    profile: await repository.getProfile(owner).then(value => value ? ({ timezone: value.timezone, pace: value.pace }) : undefined),
    goal: goal ? { id: goal.id, title: goal.title, status: goal.status, target_date: goal.targetDate, constraints: goal.constraints } : undefined,
    plan: plan ? { id: plan.id, status: plan.status, version: plan.version, period_start: plan.periodStart, period_end: plan.periodEnd } : undefined,
    tasks: tasks.map(task => ({ id: task.id, title: task.title, status: task.status, estimated_minutes: task.estimatedMinutes,
      priority: task.priority, scheduled_for: task.scheduledFor, completion_criteria: task.completionCriteria, guidance: task.guidance })),
    review: review ? { id: review.id, period: review.period, facts: review.facts, insights: review.output.insights ?? [],
      recommendations: review.output.recommendations ?? [], data_sufficiency: review.dataSufficiency } : undefined,
  };
}

/** Validate references both before enqueue and when a delayed run executes. */
export async function loadChatResources(repository: LightTickRepository, owner: LightTickOwner,
  input: Record<string, unknown>) {
  const goalId = typeof input.goal_id === "string" ? input.goal_id : undefined;
  const goal = goalId ? await repository.getGoal(owner, goalId) : undefined;
  if (!goalId || !goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
  const planId = typeof input.plan_id === "string" ? input.plan_id : undefined;
  const plan = planId ? await repository.getPlan(owner, planId) : undefined;
  if (planId && !plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
  const reviewId = typeof input.review_id === "string" ? input.review_id : undefined;
  const review = reviewId ? (await repository.listReviews(owner)).find(item => item.id === reviewId) : undefined;
  if (reviewId && !review) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Review was not found.");
  if ((goalId && plan && plan.goalId !== goalId) || (review && goalId && review.goalId !== goalId) ||
    (review && plan && review.goalId !== plan.goalId))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Context resources must belong to the same goal.");
  const taskId = typeof input.task_id === "string" ? input.task_id : undefined;
  const task = taskId ? await repository.getTask(owner, taskId) : undefined;
  if (taskId && !task) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
  if (task && (task.goalId !== goalId || (plan && task.planId !== plan.id)))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Task must belong to the requested goal and plan.");
  return { goal, plan, review, task };
}

/** Multi-turn Coach context excludes other goals, including shared thread IDs. */
export async function assembleChatContext(repository: LightTickRepository, owner: LightTickOwner,
  input: Record<string, unknown>, threadId: string, historyLimit = 20) {
  const { goal, plan, review, task } = await loadChatResources(repository, owner, input);
  const profile = await repository.getProfile(owner);
  // Legacy events do not carry a trustworthy goal id; resolve through owner-scoped tasks.
  // Orphaned task events are excluded rather than assigned from untrusted payload text.
  const events = (await repository.listExecutionEvents(owner, undefined, undefined, goal.id))
    .map(event => ({ ...event, eventType: event.eventType === "task_complete" ? "task_completed"
      : event.eventType === "task_skip" ? "task_skipped" : event.eventType }));
  const facts = aggregateExecutionFacts(events, profile?.timezone ?? "Asia/Shanghai");
  const history = (await repository.listChatMessages(owner, threadId, historyLimit, goal.id))
    .filter(message => message.role === "user" || message.role === "assistant")
    .map(message => ({ role: message.role, content: message.content }));
  return {
    request: input,
    profile: profile ? { timezone: profile.timezone, pace: profile.pace } : undefined,
    goal: { id: goal.id, title: goal.title, status: goal.status, target_date: goal.targetDate, constraints: goal.constraints },
    plan: plan ? { id: plan.id, status: plan.status, version: plan.version, period_start: plan.periodStart, period_end: plan.periodEnd } : undefined,
    task: task ? { id: task.id, title: task.title, status: task.status, estimated_minutes: task.estimatedMinutes,
      selected_variant: task.selectedVariant ?? "standard" } : undefined,
    review: review ? { id: review.id, period: review.period, insights: review.output.insights ?? [],
      recommendations: review.output.recommendations ?? [], data_sufficiency: review.dataSufficiency } : undefined,
    execution_facts: { completed_count: facts.completedCount,
      average_deviation_minutes: Number(facts.averageDeviationMinutes.toFixed(1)),
      consecutive_skip_lineages: Object.entries(facts.maxConsecutiveSkipsByLineage).map(([lineage, group]) =>
        ({ title: group.title, count: group.count })) },
    conversation: history,
  };
}
