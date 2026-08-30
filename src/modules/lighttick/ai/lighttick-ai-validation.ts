import { ApplicationError } from "../../../shared/errors.ts";

type TaskOutput = { title: string; estimated_minutes: number; priority?: number; scheduled_for?: string };

export function parseLightTickJson(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI output is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI output must be a JSON object.");
  return value as Record<string, unknown>;
}

export function validatePlanOutput(output: Record<string, unknown>, constraints: { availableMinutes: number; periodStart: string; periodEnd: string }) {
  if (!Array.isArray(output.tasks) || output.tasks.length < 1 || output.tasks.length > 50)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan task count is invalid.");
  let total = 0;
  for (const task of output.tasks as TaskOutput[]) {
    if (!task || typeof task.title !== "string" || !task.title.trim() || task.title.length > 200 ||
      !Number.isInteger(task.estimated_minutes) || task.estimated_minutes < 1 || task.estimated_minutes > 1440)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan contains an invalid task.");
    if (task.scheduled_for && (task.scheduled_for.slice(0, 10) < constraints.periodStart || task.scheduled_for.slice(0, 10) > constraints.periodEnd))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan task is outside the requested period.");
    total += task.estimated_minutes;
  }
  if (total > constraints.availableMinutes)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan exceeds the available time budget.");
  return output as { tasks: TaskOutput[] };
}

export function validateReviewOutput(output: Record<string, unknown>) {
  if (!Array.isArray(output.insights) || !Array.isArray(output.recommendations) ||
    output.insights.some(item => typeof item !== "string") || output.recommendations.some(item => typeof item !== "string"))
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI review output does not match its schema.");
  return output;
}

export function validateProposalOutput(output: Record<string, unknown>, allowedTaskIds: Set<string>) {
  if (!Array.isArray(output.diff) || !output.impact || typeof output.impact !== "object")
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI proposal output does not match its schema.");
  for (const item of output.diff as any[]) {
    if (!item || !["update_task", "cancel_task", "defer_task"].includes(item.action) || !allowedTaskIds.has(item.task_id))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI proposal crosses its authorized task boundary.");
  }
  return output;
}
