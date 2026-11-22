import type { LightTickOwner } from "../lighttick.types.ts";
export interface TodayFocusRow extends LightTickOwner {
  business_date: string;
  timezone: string;
  revision: number;
  task_id: string | null;
  title: string;
  success_criterion: string;
  first_step: string;
  selected_at: string;
}
export interface TodayFocusSnapshot {
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
