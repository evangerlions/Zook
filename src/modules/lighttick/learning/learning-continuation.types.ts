import type { LightTickOwner } from "../lighttick.types.ts";

export interface LearningContinuationPreference {
  enabled: boolean;
  reminder_time?: string;
}

export type LearningAdjustmentReason = "overdue" | "already_continued" | "missed_next_day" |
  "outside_plan" | "route_paused" | "goal_paused" | "source_unavailable" |
  "prerequisite_incomplete" | "capacity";

export interface LearningContinuationRow extends LightTickOwner {
  taskId: string;
  scheduledDate: string;
  dueDate: string;
  phase: "rollover" | "reminder" | "enqueued" | "finished" | "adjustment";
  reminderTime?: string;
  movedVersion?: number;
  adjustmentReason?: LearningAdjustmentReason;
}

export interface LearningContinuationRepository {
  get(owner: LightTickOwner, taskId: string): Promise<LearningContinuationRow | undefined>;
  list(owner: LightTickOwner): Promise<LearningContinuationRow[]>;
  listDue(now: Date, limit: number): Promise<LearningContinuationRow[]>;
  save(row: LearningContinuationRow): Promise<void>;
}

export function nextBusinessDay(date: string): string {
  const next = new Date(date + "T00:00:00.000Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function accountClock(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
}
