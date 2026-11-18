import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickRecordRow, LightTickTaskRow, LightTickReflectionRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * Phase 1: Weekly review aggregation.
 *
 * Aggregates records, tasks, reflections and reviews within a given week
 * (Monday–Sunday). Returns a snapshot with stats and source items.
 * Past weeks are frozen at the boundary instant; future weeks are rejected.
 */

export interface WeeklyRecordSummary {
  id: string;
  title: string;
  record_date: string;
  prompt_kind: string;
  tags: string[];
}

export interface WeeklyTaskSummary {
  id: string;
  title: string;
  status: string;
  completed_at?: string;
  estimated_minutes: number | null;
}

export interface WeeklyReflectionSummary {
  id: string;
  content: string;
  created_at: string;
}

export interface WeeklyStats {
  record_count: number;
  task_completed_count: number;
  task_pending_count: number;
  reflection_count: number;
  action_days: number;
  loop_days: number;
}

export interface WeeklyReviewResult {
  week_start: string;
  week_end: string;
  as_of: string;
  is_partial: boolean;
  stats: WeeklyStats;
  records: WeeklyRecordSummary[];
  tasks: WeeklyTaskSummary[];
  reflections: WeeklyReflectionSummary[];
  timezone: string;
}

export class LightTickRhythmWeeklyService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async get(owner: LightTickOwner, weekStart: string): Promise<WeeklyReviewResult> {
    const start = parseMonday(weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const endStr = toIsoDate(end);
    const now = this.clock();
    const nowStr = toIsoDate(now);

    if (start > now) {
      throw new ApplicationError(422, "REQ_FIELD_INVALID", "未来周尚无回顾。");
    }

    const profile = await this.repository.getProfile(owner);
    const timezone = profile?.timezone ?? "UTC";

    // Gather all records, tasks, reflections within the week
    const allRecords = await this.repository.listRecords(owner);
    const allTasks = await this.repository.listTasks(owner);
    const allReflections = await this.repository.listReflections(owner);

    const weekRecords = allRecords.filter(r => {
      const d = r.payload.record_date;
      return d >= weekStart && d <= endStr;
    });

    const weekTasks = allTasks.filter(t => {
      const scheduled = t.scheduledFor ?? t.createdAt.slice(0, 10);
      return scheduled >= weekStart && scheduled <= endStr;
    });

    const weekReflections = allReflections.filter(r => {
      const d = r.createdAt.slice(0, 10);
      return d >= weekStart && d <= endStr;
    });

    const completedTasks = weekTasks.filter(t => t.status === "completed");
    const pendingTasks = weekTasks.filter(t => t.status === "pending" || t.status === "in_progress");

    // Count action days (days with at least one record or completed task)
    const recordDays = new Set(weekRecords.map(r => r.payload.record_date));
    const taskDays = new Set(completedTasks.map(t => (t.scheduledFor ?? t.createdAt).slice(0, 10)));
    const actionDays = new Set([...recordDays, ...taskDays]);

    // Count loop days (days with both action and reflection)
    const reflectionDays = new Set(weekReflections.map(r => r.createdAt.slice(0, 10)));
    const loopDays = new Set([...actionDays].filter(d => reflectionDays.has(d)));

    const isPartial = end > now;
    const asOf = isPartial ? nowStr : endStr;

    return {
      week_start: weekStart,
      week_end: endStr,
      as_of: asOf,
      is_partial: isPartial,
      timezone,
      stats: {
        record_count: weekRecords.length,
        task_completed_count: completedTasks.length,
        task_pending_count: pendingTasks.length,
        reflection_count: weekReflections.length,
        action_days: actionDays.size,
        loop_days: loopDays.size,
      },
      records: weekRecords.map(r => ({
        id: r.id,
        title: r.payload.raw_text.split("\n")[0].slice(0, 200) || "Record",
        record_date: r.payload.record_date,
        prompt_kind: r.payload.prompt_kind,
        tags: r.payload.tags,
      })),
      tasks: weekTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        completed_at: t.completedAt,
        estimated_minutes: t.estimatedMinutes,
      })),
      reflections: weekReflections.map(r => ({
        id: r.id,
        content: r.content?.slice(0, 500) ?? "",
        created_at: r.createdAt,
      })),
    };
  }
}

function parseMonday(weekStart: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "week_start must be YYYY-MM-DD.");
  }
  const d = new Date(weekStart + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "week_start is not a valid date.");
  }
  // Must be Monday
  if (d.getUTCDay() !== 1) {
    throw new ApplicationError(422, "REQ_FIELD_INVALID", "请选择周一作为周起始日期。");
  }
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
