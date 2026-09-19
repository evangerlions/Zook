import { ApplicationError } from "../../../shared/errors.ts";
import { PLANNING_FIELDS, type PlanningContext, type PlanningField, type PlanningSession } from "./planning.types.ts";
export const planningError = (status: number, code: string, message: string): never => { throw new ApplicationError(status, code, message); };
export function positiveVersion(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) planningError(400, "REQ_FIELD_INVALID", "A positive integer version is required.");
  return Number(value);
}
export function text(value: unknown, limit = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) planningError(400, "REQ_FIELD_INVALID", "Text is missing or too long.");
  return (value as string).trim();
}
export function validField(key: string, value: unknown): string | number {
  if (!(PLANNING_FIELDS as readonly string[]).includes(key)) planningError(400, "REQ_FIELD_INVALID", "Unknown planning context field.");
  if (key === "available_minutes") {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10080) planningError(400, "REQ_FIELD_INVALID", "Available minutes must be 1–10080.");
    return Number(value);
  }
  const result = text(value, key === "objective" || key === "outcome" ? 200 : 1000);
  if (key.startsWith("period_") && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result))
    planningError(400, "REQ_FIELD_INVALID", "Planning dates must be valid YYYY-MM-DD values.");
  return result;
}
export function validatePeriod(context: PlanningContext) {
  const start = context.period_start?.value, end = context.period_end?.value;
  if (start && end && (String(end) < String(start) || Date.parse(String(end)) - Date.parse(String(start)) > 90 * 86400000))
    planningError(400, "REQ_FIELD_INVALID", "Planning period must be ordered and at most 90 days.");
}
export function missing(context: PlanningContext): PlanningField[] {
  return (["objective", "available_minutes", "period_start", "period_end"] as PlanningField[])
    .filter(key => !context[key] || context[key]!.source === "assumption");
}
export function readyState(session: PlanningSession): PlanningSession {
  const needed = missing(session.context);
  const labels = { objective: "你想得到什么具体结果？", available_minutes: "这个周期总共能投入多少分钟？", period_start: "计划从哪天开始？", period_end: "计划到哪天结束？" };
  return { ...session, status: needed.length ? "collecting" : "ready",
    questions: session.clarificationRounds >= 2 ? [] : needed.slice(0, 2).map(key => labels[key as keyof typeof labels]) };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}`;
  return JSON.stringify(value);
}
export function sessionData(row: PlanningSession) {
  return { id: row.id, goal_id: row.goalId, thread_id: row.threadId, status: row.status, version: row.version,
    context_revision: row.contextRevision, context: row.context, questions: row.questions, clarification_rounds: row.clarificationRounds,
    active_run_id: row.activeRunId ?? null, draft_plan_id: row.draftPlanId ?? null, draft_revision: row.draftRevision ?? null,
    draft_expires_at: row.draftExpiresAt ?? null, last_error: row.lastError ?? null,
    can_generate: !missing(row.context).length && !row.activeRunId && row.status !== "confirmed",
    created_at: row.createdAt, updated_at: row.updatedAt };
}
