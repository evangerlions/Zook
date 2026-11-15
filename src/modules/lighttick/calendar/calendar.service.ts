import { normalizeWorkspace } from "../actions/action.facts.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export const calendarSources = {
  tasks: "目标任务",
  learning: "课程学完",
  reading: "阅读",
  records: "随手记录",
  actions: "共享行动",
  focus: "专注与休息",
};
export type CalendarSource = keyof typeof calendarSources;
export interface CalendarItem {
  id: string;
  source: CalendarSource;
  kind: string;
  date: string;
  date_basis: string;
  title: string;
  status: string;
  source_id: string;
  version: string;
  href: string;
  available: boolean;
  minutes: number | null;
}
const fail = (code: number, message: string): never => {
  throw new ApplicationError(code, "REQ_FIELD_INVALID", message);
};
export function calendarQuery(
  q: Record<string, string | undefined>,
  now: Date,
  timezone: string,
) {
  const month = q.month ?? businessDateAt(now, timezone).slice(0, 7),
    source = q.source ?? "",
    day = q.day ?? "",
    page = Number(q.page ?? 1);
  if (
    !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) ||
    (source && !Object.hasOwn(calendarSources, source)) ||
    !Number.isSafeInteger(page) ||
    page < 1
  )
    fail(422, "请选择有效月份、来源和页码。");
  const start = month + "-01",
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < start || day > end))
    fail(422, "日期必须位于所选月份。");
  return { month, start, end, source, day, page };
}
export function projectCalendar(
  rows: CalendarItem[],
  q: ReturnType<typeof calendarQuery>,
  timezone: string,
  now: Date,
  unknown: number,
  coverage: { source: CalendarSource; status: string }[],
) {
  if (
    rows.length > 20000 ||
    Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 ** 2
  )
    fail(413, "活动日历超过容量，请使用更大的索引投影。");
  const all = [...new Map(rows.map((r) => [r.id, r])).values()].filter(
    (r) => r.date >= q.start && r.date <= q.end,
  );
  const filtered = all.filter((r) => !q.source || r.source === q.source);
  const items = filtered
    .filter((r) => !q.day || r.date === q.day)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(items.length / 20)),
    page = Math.min(q.page, pages);
  const days = Array.from({ length: Number(q.end.slice(8)) }, (_, i) => {
    const date = q.month + "-" + String(i + 1).padStart(2, "0"),
      found = filtered.filter((r) => r.date === date);
    const scheduled = found.filter((r) => r.kind.endsWith("_scheduled")).length;
    return { date, scheduled, recorded: found.length - scheduled };
  });
  return {
    month: q.month,
    start: q.start,
    end: q.end,
    timezone,
    snapshot_at: now.toISOString(),
    source: q.source,
    day: q.day,
    page,
    pages,
    page_size: 20,
    total: items.length,
    unknown_date_count: unknown,
    coverage,
    days,
    sources: Object.entries(calendarSources).map(([key, title]) => ({
      key,
      title,
      count: all.filter((r) => r.source === key).length,
    })),
    items: items.slice((page - 1) * 20, page * 20),
  };
}
export class CalendarService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async read(owner: LightTickOwner, query: Record<string, string | undefined>) {
    return this.repo.transaction(owner, async () => {
      const now = this.now(),
        timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC",
        q = calendarQuery(query, now, timezone);
      const rows: CalendarItem[] = [],
        coverage: { source: CalendarSource; status: string }[] = [];
      let unknown = 0;
      const cap = (values: unknown[]) => {
        if (values.length > 5000)
          fail(413, "活动日历单来源超过5000条，请使用更大的索引投影。");
      };
      const date = (v: string | null | undefined) =>
        v && Number.isFinite(Date.parse(v))
          ? businessDateAt(new Date(v), timezone)
          : null;
      const add = (
        source: CalendarSource,
        kind: string,
        id: string,
        title: string,
        day: string | null | undefined,
        basis: string,
        version: string,
        status: string,
        href: string,
        minutes: number | null = null,
        available = true,
      ) => {
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          if (!q.source || q.source === source) unknown++;
          return;
        }
        if (day < q.start || day > q.end) return;
        rows.push({
          id: source + ":" + kind + ":" + id,
          source,
          kind,
          date: day,
          date_basis: basis,
          source_id: id,
          version,
          title: title.slice(0, 240),
          status,
          href,
          minutes,
          available,
        });
      };
      const tasks = await this.repo.listTasks(owner);
      cap(tasks);
      const taskMap = new Map(tasks.map((t) => [t.id, t]));
      const taskHref = (t: (typeof tasks)[number]) =>
        "/grow/growth/plans?" +
        new URLSearchParams({ focus: t.planId, task: t.id, goal: t.goalId });
      for (const t of tasks)
        add(
          "tasks",
          "task_scheduled",
          t.id,
          t.title,
          t.scheduledFor && /^\d{4}-\d{2}-\d{2}$/.test(t.scheduledFor)
            ? t.scheduledFor
            : date(t.scheduledFor),
          "scheduled_date",
          String(t.version),
          t.status,
          taskHref(t),
        );
      const events = await this.repo.listExecutionEvents(
        owner,
        new Date(Date.parse(q.start) - 2 * 86400000).toISOString(),
        new Date(Date.parse(q.end) + 3 * 86400000).toISOString(),
      );
      cap(events);
      for (const e of events) {
        if (
          e.aggregateType !== "task" ||
          e.payload.valid_action !== true ||
          Date.parse(e.occurredAt) > now.getTime()
        )
          continue;
        const complete =
            e.eventType === "task_complete" && e.payload.action === "complete",
          minimum =
            e.eventType === "task_minimum_step_recorded" &&
            e.payload.action === "minimum_step" &&
            e.payload.task_completed === false;
        if (!complete && !minimum) continue;
        const t = taskMap.get(e.aggregateId);
        if (!t) continue;
        const variant = ["standard", "light", "minimum"].includes(
          String(e.payload.selected_variant),
        )
          ? String(e.payload.selected_variant)
          : "unknown";
        add(
          "tasks",
          complete ? "task_completed" : "task_minimum",
          e.id,
          t.title,
          date(e.occurredAt),
          "event_timestamp",
          String(e.aggregateVersion),
          complete ? variant : "minimum_attempt",
          taskHref(t),
          null,
        );
      }
      const authority = await this.repo.getLearningAuthority(owner),
        learning = authority?.phase === "zook" && authority.readingEnabled;
      coverage.push({
        source: "learning",
        status: !learning
          ? "not_authorized"
          : authority.privateEnabled
            ? "included"
            : "partial",
      });
      if (learning) {
        const completions = await this.repo.listLearningCompletions(
          owner,
          authority.privateEnabled,
        );
        cap(completions);
        for (const c of completions)
          if (!c.completed_at || Date.parse(c.completed_at) <= now.getTime())
            add(
              "learning",
              "lesson_completed",
              c.lesson_id + ":" + c.content_version,
              c.title,
              date(c.completed_at),
              "completion_timestamp",
              c.content_version,
              c.is_current ? "current" : "historical",
              "/grow/learning?" +
                new URLSearchParams({
                  lesson: c.lesson_id,
                  version: c.content_version,
                }),
              null,
              c.available,
            );
      }
      const articles = await this.repo.listReadingArticles(owner),
        states = await this.repo.listReadingStates(owner);
      cap(articles);
      cap(states);
      const articleMap = new Map(articles.map((a) => [a.id, a]));
      const readingHref = (id: string) =>
        "/grow/reading?article=" + encodeURIComponent(id);
      const readingTasks = await this.repo.listReadingEntries(owner, "task", {
        start: q.start,
        end: q.end,
        limit: 5001,
      });
      cap(readingTasks);
      for (const t of readingTasks)
        add(
          "reading",
          "reading_scheduled",
          t.id,
          t.title,
          t.business_date,
          "scheduled_business_date",
          String(t.revision),
          t.status,
          readingHref(t.article_id),
          null,
          articleMap.has(t.article_id),
        );
      for (const s of states)
        if (s.completedAt && Date.parse(s.completedAt) <= now.getTime()) {
          const a = articleMap.get(s.articleId);
          if (a)
            add(
              "reading",
              "reading_completed",
              a.id,
              a.title,
              date(s.completedAt),
              "completion_timestamp",
              String(s.revision),
              "completed",
              readingHref(a.id),
            );
        }
      const records = await this.repo.listRecords(owner, {
        archived: "false",
        limit: 5001,
      });
      cap(records);
      for (const { payload: r } of records)
        add(
          "records",
          "record_saved",
          r.id,
          r.raw_text,
          r.record_date,
          "record_date",
          String(r.version),
          "saved",
          "/grow/records?focus=" + encodeURIComponent(r.id),
        );
      const stored = await this.repo.getActionWorkspace(owner),
        workspace = stored
          ? { ...stored, data: normalizeWorkspace(stored.data) }
          : undefined;
      cap(workspace?.data.plans ?? []);
      cap(workspace?.data.records ?? []);
      const plans = workspace?.data.plans ?? [],
        planMap = new Map(plans.map((p) => [p.id, p]));
      const actionHref = (id: string) =>
        "/grow/growth/actions?id=" + encodeURIComponent(id);
      for (const p of plans)
        if (p.period === "day" && p.status !== "archived")
          add(
            "actions",
            "action_scheduled",
            p.id,
            p.title,
            p.start_date,
            "scheduled_date",
            String(p.revision),
            p.status,
            actionHref(p.id),
          );
      const reversed = new Set(
        (workspace?.data.records ?? [])
          .filter((r) => r.record_kind === "reversal")
          .map((r) => r.reverses_record_id),
      );
      for (const r of workspace?.data.records ?? [])
        if (
          r.outcome !== "running" &&
          r.record_kind !== "reversal" &&
          (r.record_kind === "session" || !reversed.has(r.id))
        )
          add(
            "actions",
            r.record_kind === "session" ? "action_session" : "action_completed",
            r.id,
            r.title,
            r.business_date,
            r.date_basis === "legacy_planned"
              ? "legacy_planned_date"
              : "frozen_business_date",
            String(planMap.get(r.plan_id)?.revision ?? 0),
            reversed.has(r.id) ? "reopened" : r.outcome,
            actionHref(r.plan_id),
            r.record_kind === "session" ? r.actual_minutes : null,
            planMap.has(r.plan_id),
          );
      const focus = await this.repo.focus.history(owner, 0, 5001);
      if (focus.total > 5000) cap(Array(5001));
      for (const f of focus.items)
        if (f.status === "saved")
          add(
            "focus",
            f.kind === "focus" ? "focus_saved" : "break_saved",
            f.id,
            f.title || calendarSources.focus,
            f.business_date,
            "frozen_start_business_date",
            String(f.revision),
            f.kind,
            "/grow/focus?session=" + encodeURIComponent(f.id),
            (f.actual_seconds ?? 0) / 60,
          );
      return projectCalendar(rows, q, timezone, now, unknown, coverage);
    });
  }
}
