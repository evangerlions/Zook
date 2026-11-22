import type { LightTickOwner } from "../lighttick.types.ts";
export interface WeeklyFact {
  id: string;
  task_id: string;
  kind: "completed" | "minimum";
  task_variant?: "standard" | "light" | "minimum" | null;
  title: string;
  note: string;
  activity_at: string;
  activity_date: string;
  task_version: number;
}
export interface TargetRef {
  task_id: string;
  task_version: number;
  plan_id: string;
  plan_version: number;
  goal_id: string;
  goal_version: number;
}
export interface WeeklyTarget extends TargetRef {
  title: string;
  scheduled_date: string;
}
export interface WeeklySnapshot {
  week_start: string;
  week_end: string;
  as_of: string;
  is_partial: boolean;
  timezone: string;
  stats: {
    completed_count: number;
    minimum_count: number;
    action_days: number;
  };
  facts: WeeklyFact[];
  snapshot_hash: string;
}
export interface WeeklyVersion extends WeeklySnapshot {
  revision: number;
  confirmed_at: string;
  selected_fact_ids: string[];
  review_text: string;
  adjustment_text: string;
  adjustment_target: WeeklyTarget | null;
}
export interface WeeklyCard extends WeeklyVersion {
  history: WeeklyVersion[];
}
export interface WeeklyStore {
  get(o: LightTickOwner, week: string): Promise<WeeklyCard | undefined>;
  save(o: LightTickOwner, c: WeeklyCard, base: number): Promise<void>;
  list(
    o: LightTickOwner,
  ): Promise<{ week_start: string; revision: number; confirmed_at: string }[]>;
}
export interface WeeklyWrite {
  base_revision: number;
  snapshot_hash: string;
  selected_fact_ids: string[];
  review_text: string;
  adjustment_text: string;
  adjustment_target: TargetRef | null;
}
