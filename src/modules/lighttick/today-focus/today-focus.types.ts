import type { LightTickOwner } from "../lighttick.types.ts";
export interface MinimumAttempt {
  id: string;
  task_id: string;
  step: string;
  recorded_at: string;
  task_version: number;
}
export interface DailyRhythmFields {
  mode?: "standard" | "minimum" | "rest";
  minimum_step?: string;
  attempts?: MinimumAttempt[];
}
export interface TodayFocusRow extends LightTickOwner, DailyRhythmFields {
  business_date: string;
  timezone: string;
  revision: number;
  task_id: string | null;
  title: string;
  success_criterion: string;
  first_step: string;
  selected_at: string;
}
export interface TodayFocusSnapshot extends DailyRhythmFields {
  business_date: string;
  timezone: string;
  revision: number;
  task_id: string | null;
  task_version: number | null;
  title: string;
  success_criterion: string;
  first_step: string;
  selected_at: string | null;
  status: "automatic" | "active" | "completed" | "unavailable";
}
export interface TodayFocusRepository {
  get(o: LightTickOwner, date: string): Promise<TodayFocusRow | undefined>;
  save(row: TodayFocusRow, base: number): Promise<void>;
}
