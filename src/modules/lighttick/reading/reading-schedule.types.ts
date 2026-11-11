import type { LightTickOwner } from "../lighttick.types.ts";
export interface ReadingScheduleDay {
  date: string;
  revision: number;
  preferences_revision: number;
  goal: number;
  attempts: number;
  phase: "pending" | "complete" | "stopped";
  work_id: string | null;
  work_ids: string[];
  adopted: {
    article_id: string;
    revision: number;
    work_id: string;
    index: number;
  }[];
  skipped: {
    work_id: string;
    index: number;
    url: string;
    reason: "already_saved";
  }[];
  next_at: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReadingScheduleRepository {
  get(o: LightTickOwner, date: string): Promise<ReadingScheduleDay | undefined>;
  history(
    o: LightTickOwner,
    before: string,
    limit: number,
  ): Promise<ReadingScheduleDay[]>;
  due(
    date: string,
    minute: number,
    now: string,
    limit: number,
  ): Promise<LightTickOwner[]>;
  save(o: LightTickOwner, row: ReadingScheduleDay, base: number): Promise<void>;
}
