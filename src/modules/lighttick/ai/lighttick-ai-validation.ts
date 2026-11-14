import { businessDateAt } from "../lighttick-today.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";

import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import type { LightTickTaskGuidance } from "../lighttick.types.ts";

type TaskOutput = { title: string; estimated_minutes: number; priority?: number; scheduled_for?: string; completion_criteria?: string; steps?: string[]; guidance?: LightTickTaskGuidance };

export function parseLightTickJson(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI output is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI output must be a JSON object.");
  return value as Record<string, unknown>;
}

export function validatePlanOutput(output: Record<string, unknown>, constraints: { availableMinutes: number; periodStart: string; periodEnd: string; timezone?: string }) {
  if (!Number.isFinite(constraints.availableMinutes) || constraints.availableMinutes < 1)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan requires a positive time budget.");
  if (!Array.isArray(output.tasks) || output.tasks.length < 1 || output.tasks.length > 50)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan task count is invalid.");
  if ((output.summary !== undefined && (typeof output.summary !== "string" || output.summary.length > 2000)) ||
    (output.assumptions !== undefined && (!Array.isArray(output.assumptions) || output.assumptions.length > 10 ||
      output.assumptions.some(item => typeof item !== "string" || item.length > 500))))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Plan summary or assumptions are invalid.");
  let total = 0;
  for (const task of output.tasks as TaskOutput[]) {
    if (!task || typeof task.title !== "string" || !task.title.trim() || task.title.length > 200 ||
      !Number.isInteger(task.estimated_minutes) || task.estimated_minutes < 1 || task.estimated_minutes > 1440)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan contains an invalid task.");
    const scheduledDay = typeof task.scheduled_for === "string" && Number.isFinite(Date.parse(task.scheduled_for))
      ? constraints.timezone && task.scheduled_for.includes("T") ? businessDateAt(new Date(task.scheduled_for),constraints.timezone) : task.scheduled_for.slice(0,10) : "";
    if (task.scheduled_for !== undefined && (typeof task.scheduled_for !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(task.scheduled_for) ||
      !Number.isFinite(Date.parse(task.scheduled_for)) ||
      new Date(task.scheduled_for.slice(0, 10)).toISOString().slice(0, 10) !== task.scheduled_for.slice(0, 10) ||
      scheduledDay < constraints.periodStart || scheduledDay > constraints.periodEnd))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan task is outside the requested period.");
    taskDetailsFromOutput(task);
    total += task.estimated_minutes;
  }
  if (total > constraints.availableMinutes)
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "AI plan exceeds the available time budget.");
  return output as { tasks: TaskOutput[] };
}

export function validateReviewOutput(output: Record<string, unknown>) {
  // 合同里 insights 是 string[]，而 recommendations 是 oneOf[string, object]
  // （LightTickReviewActionView.recommendations）。模型实际会返回对象形态的建议，
  // 下游 normalizeReviewRecommendations 两种都能吃，所以校验不能比合同更严，
  // 否则真实输出会被判 502 并整体降级为 facts_only。
  if (!Array.isArray(output.insights) || !Array.isArray(output.recommendations) ||
    output.insights.some(item => typeof item !== "string") ||
    output.recommendations.some(item => typeof item !== "string" &&
      (!item || typeof item !== "object" || Array.isArray(item))))
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

/**
 * 导读输出校验。两件事必须在这里做完，不能留到界面：
 * 1. 四个分区逐条校验，空字符串不算内容；
 * 2. `basis` 只允许往保守方向纠正——只有摘要时，模型不得声称读了全文。
 *    反向不纠正：模型自认「只基于摘要」而实际有全文，是更保守的说法，允许保留。
 */
export function validateReadingGuideOutput(output: Record<string, unknown>,
  authoritativeBasis: "full_text" | "summary") {
  const sections = (value: unknown, field: string, min: number, max: number, itemMax: number): string[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max)
      throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", `AI reading guide ${field} is invalid.`);
    for (const item of value)
      if (typeof item !== "string" || !item.trim() || item.length > itemMax)
        throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", `AI reading guide ${field} contains an invalid entry.`);
    return (value as string[]).map(item => item.trim());
  };
  if (output.basis !== "full_text" && output.basis !== "summary")
    throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "AI reading guide basis is invalid.");
  return {
    basis: authoritativeBasis === "summary" ? "summary" as const : output.basis as "full_text" | "summary",
    core_points: sections(output.core_points, "core_points", 1, 6, 400),
    evidence_limits: sections(output.evidence_limits, "evidence_limits", 0, 5, 400),
    language_notes: sections(output.language_notes, "language_notes", 0, 6, 400),
    application_questions: sections(output.application_questions, "application_questions", 1, 5, 300),
  };
}
