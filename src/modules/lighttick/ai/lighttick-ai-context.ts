import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

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
  return {
    request: input,
    profile: await repository.getProfile(owner).then(value => value ? ({ timezone: value.timezone, pace: value.pace }) : undefined),
    goal: goal ? { id: goal.id, title: goal.title, status: goal.status, target_date: goal.targetDate, constraints: goal.constraints } : undefined,
    plan: plan ? { id: plan.id, status: plan.status, version: plan.version, period_start: plan.periodStart, period_end: plan.periodEnd } : undefined,
    tasks: tasks.map(task => ({ id: task.id, title: task.title, status: task.status, estimated_minutes: task.estimatedMinutes,
      priority: task.priority, scheduled_for: task.scheduledFor })),
    review: review ? { id: review.id, period: review.period, facts: review.facts, insights: review.output.insights ?? [],
      recommendations: review.output.recommendations ?? [], data_sufficiency: review.dataSufficiency } : undefined,
  };
}
