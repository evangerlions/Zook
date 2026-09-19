import type { LightTickOwner } from "../lighttick.types.ts";
export const PLANNING_FIELDS = ["objective", "outcome", "experience", "available_minutes", "period_start", "period_end", "constraints"] as const;
export type PlanningField = typeof PLANNING_FIELDS[number];
export type PlanningValue = { value: string | number; source: "user" | "confirmed" | "imported" | "assumption"; source_message_id?: string };
export type PlanningContext = Partial<Record<PlanningField, PlanningValue>>;
export interface PlanningSession extends LightTickOwner {
  id: string; goalId: string; threadId: string;
  status: "collecting" | "ready" | "generating" | "draft_ready" | "confirmed";
  version: number; contextRevision: number; context: PlanningContext; questions: string[]; clarificationRounds: number;
  activeRunId?: string; draftPlanId?: string; draftRevision?: number; draftExpiresAt?: string;
  baseSnapshot?: string; lastError?: string; createdAt: string; updatedAt: string;
}
