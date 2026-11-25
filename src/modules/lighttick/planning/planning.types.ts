import type { LightTickOwner } from "../lighttick.types.ts";
export const PLANNING_FIELDS = [
  "objective", "outcome", "experience", "available_minutes", "period_start", "period_end", "constraints",
  "mode", "secondary_mode", "materials", "identity", "existing_plan",
] as const;
export type PlanningField = typeof PLANNING_FIELDS[number];
export const PLANNING_MODES = ["deadline", "skill", "project", "routine", "exploration"] as const;
export type PlanningMode = typeof PLANNING_MODES[number];
export type PlanningValue = { value: string | number; source: "user" | "confirmed" | "imported" | "assumption"; source_message_id?: string };
export type PlanningContext = Partial<Record<PlanningField, PlanningValue>>;
export interface ExistingPlanReview {
  lines: {
    line_number: number;
    text: string;
    source_date: string | null;
    estimated_minutes: number | null;
    likely_duplicates: { task_id: string; title: string; scheduled_date: string | null }[];
  }[];
}
export interface PlanningSession extends LightTickOwner {
  id: string; goalId: string; threadId: string;
  status: "collecting" | "ready" | "generating" | "draft_ready" | "confirmed";
  version: number; contextRevision: number; context: PlanningContext; questions: string[]; clarificationRounds: number;
  activeRunId?: string; draftPlanId?: string; draftRevision?: number; draftExpiresAt?: string;
  baseSnapshot?: string; lastError?: string; createdAt: string; updatedAt: string;
  previousPlanId?: string;
  stageId?: string;
  subjectId?: string;
  existingPlanReview?: ExistingPlanReview;
}

export interface PlanningSessionSummary {
  id: string;
  goalId: string;
  goalTitle: string;
  status: PlanningSession["status"];
  updatedAt: string;
  draftPlanId?: string | null;
  draftExpiresAt?: string | null;
  previousPlanId?: string | null;
  stageId?: string | null;
  subjectId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}
