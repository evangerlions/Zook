import type { LightTickOwner } from "../lighttick.types.ts";
export interface FocusPreferences {
  revision: number;
  focus_minutes: number;
  break_minutes: number;
  reminders_enabled: boolean;
  updated_at: string | null;
}
export interface FocusRow extends LightTickOwner {
  id: string;
  revision: number;
  kind: "focus" | "break";
  title: string;
  planned_seconds: number;
  status: "running" | "paused" | "saved" | "discarded";
  accumulated_ms: number;
  segment_started_at: string | null;
  actual_seconds: number | null;
  notes: string;
  timezone: string;
  business_date: string;
  started_at: string;
  finished_at: string | null;
  reminder_snoozed_until: string | null;
  reminder_dismissed: boolean;
}
export interface FocusSession
  extends Omit<
    FocusRow,
    "appId" | "userId" | "accumulated_ms" | "segment_started_at"
  > {
  elapsed_seconds: number;
  remaining_seconds: number;
  due_at: string | null;
  target_reached: boolean;
  reminder_due: boolean;
}
export interface FocusReceipt {
  server_time: string;
  session: FocusSession | null;
  preferences: FocusPreferences;
}
export interface FocusRepository {
  preferences(o: LightTickOwner): Promise<FocusPreferences | undefined>;
  savePreferences(
    o: LightTickOwner,
    row: FocusPreferences,
    base: number,
  ): Promise<void>;
  active(o: LightTickOwner): Promise<FocusRow | undefined>;
  get(o: LightTickOwner, id: string): Promise<FocusRow | undefined>;
  save(row: FocusRow, base: number): Promise<void>;
  history(
    o: LightTickOwner,
    offset: number,
    limit: number,
    kind?: string,
  ): Promise<{ items: FocusRow[]; total: number }>;
  summary(
    o: LightTickOwner,
    start: string,
    end: string,
  ): Promise<{
    sessions: number;
    seconds: number;
    days: number;
    dates: string[];
  }>;
}
export const defaultFocusPreferences = (): FocusPreferences => ({
  revision: 0,
  focus_minutes: 25,
  break_minutes: 5,
  reminders_enabled: true,
  updated_at: null,
});
export function elapsedFocusMs(row: FocusRow, now: Date) {
  return Math.min(
    row.planned_seconds * 1000,
    Math.max(0, row.accumulated_ms) +
      (row.status === "running" && row.segment_started_at
        ? Math.max(0, now.getTime() - Date.parse(row.segment_started_at))
        : 0),
  );
}
export function projectFocus(
  row: FocusRow,
  now: Date,
  prefs: FocusPreferences,
): FocusSession {
  const elapsed = elapsedFocusMs(row, now),
    active = ["running", "paused"].includes(row.status),
    target = elapsed >= row.planned_seconds * 1000;
  const { appId, userId, accumulated_ms, segment_started_at, ...rest } = row;
  return {
    ...rest,
    elapsed_seconds: Math.floor(elapsed / 1000),
    remaining_seconds: Math.max(
      0,
      row.planned_seconds - Math.floor(elapsed / 1000),
    ),
    due_at:
      row.status === "running" && segment_started_at
        ? new Date(
            Date.parse(segment_started_at) +
              row.planned_seconds * 1000 -
              accumulated_ms,
          ).toISOString()
        : null,
    target_reached: target,
    reminder_due:
      active &&
      row.status === "running" &&
      target &&
      prefs.reminders_enabled &&
      !row.reminder_dismissed &&
      (!row.reminder_snoozed_until ||
        row.reminder_snoozed_until <= now.toISOString()),
  };
}
