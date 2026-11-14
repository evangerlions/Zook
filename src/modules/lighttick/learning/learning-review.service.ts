import type { NativeLearningService } from "./native-learning.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningCompletion } from "./learning-review.types.ts";
import type { FormRecords } from "../form-records/form-records.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { fail } from "./native-learning.validation.ts";
export function reviewQuery(
  query: Record<string, string | undefined>,
  now: Date,
  timezone = "UTC",
) {
  const month = query.month ?? businessDateAt(now, timezone).slice(0, 7),
    module = query.module ?? "";
  if (
    !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) ||
    module.length > 110 ||
    (module &&
      !/^(?:module\/[a-z][a-z0-9-]{0,79}|manual\/[a-zA-Z0-9_-]+|courses|unassigned)$/.test(
        module,
      ))
  )
    fail(422, "Invalid review month or module.");
  return { month, module, timezone };
}
export function buildLearningReview(
  rows: LearningCompletion[],
  input: { month: string; module: string; timezone: string },
  forms: Pick<FormRecords, "modules" | "checkins" | "habits">,
) {
  const { month, module, timezone } = input,
    start = month + "-01",
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
  const days = Array.from({ length: Number(end.slice(8)) }, (_, i) => ({
    date: month + "-" + String(i + 1).padStart(2, "0"),
    completed_lessons: 0,
    module_days: 0,
    manual_modules: 0,
    manual_minutes: 0,
    action_minutes: 0,
    goal_minutes: 0,
  }));
  const byDay = new Map(days.map((d) => [d.date, d])),
    moduleDates = new Map<string, Set<string>>(),
    moduleCounts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const r of rows) labels.set(r.module, r.module_label);
  for (const m of forms.modules) labels.set("manual/" + m.id, m.name);
  const seen = new Set<string>(),
    dayModules = new Map<string, Set<string>>();
  let unknown = 0;
  const items: (LearningCompletion & { date: string })[] = [];
  const mark = (key: string, date: string) => {
    if (!moduleDates.has(key)) moduleDates.set(key, new Set());
    moduleDates.get(key)!.add(date);
    if (!module || key === module) {
      if (!dayModules.has(date)) dayModules.set(date, new Set());
      dayModules.get(date)!.add(key);
    }
  };
  for (const row of rows) {
    const id = row.lesson_id + ":" + row.content_version;
    if (seen.has(id)) continue;
    seen.add(id);
    const date =
      row.completed_at && Number.isFinite(Date.parse(row.completed_at))
        ? businessDateAt(new Date(row.completed_at), timezone)
        : null;
    if (!date) {
      if (!module || row.module === module) unknown++;
      continue;
    }
    if (!byDay.has(date)) continue;
    mark(row.module, date);
    moduleCounts.set(row.module, (moduleCounts.get(row.module) ?? 0) + 1);
    if (!module || row.module === module) {
      byDay.get(date)!.completed_lessons++;
      items.push({ ...row, date });
    }
  }
  for (const [date, checks] of Object.entries(forms.checkins))
    if (byDay.has(date))
      for (const m of forms.modules)
        if (Number(checks[m.id]) > 0) {
          const key = "manual/" + m.id;
          mark(key, date);
          if (!module || module === key) byDay.get(date)!.manual_modules++;
        }
  for (const day of days) {
    day.module_days = dayModules.get(day.date)?.size ?? 0;
    const minutes = forms.habits[day.date]?.minutes;
    day.manual_minutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }
  items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      String(b.completed_at).localeCompare(String(a.completed_at)) ||
      a.lesson_id.localeCompare(b.lesson_id) ||
      a.content_version.localeCompare(b.content_version),
  );
  return {
    month,
    start,
    end,
    timezone,
    summary: {
      learning_days: days.filter((d) => d.module_days > 0).length,
      completed_lessons: items.length,
    },
    unknown_date_count: unknown,
    modules: [...labels]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, title]) => ({
        key,
        title,
        learning_days: moduleDates.get(key)?.size ?? 0,
        completed_lessons: moduleCounts.get(key) ?? 0,
      })),
    days,
    items,
  };
}
export class LearningReviewService {
  constructor(
    private readonly learning: NativeLearningService,
    private readonly repo: LightTickRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async read(owner: LightTickOwner, query: Record<string, string | undefined>) {
    return this.repo.transaction(owner, async () => {
      const authority = await this.learning.requireActive(owner);
      if (!authority.readingEnabled)
        fail(403, "Learning reading consent is required.");
      const timezone = (await this.repo.getProfile(owner))?.timezone ?? "UTC",
        input = reviewQuery(query, this.now(), timezone);
      const rows = await this.repo.listLearningCompletions(
        owner,
        authority.privateEnabled,
      );
      if (rows.length > 5000)
        fail(
          413,
          "Learning review exceeds 5000 retained completions; an indexed range projection is required.",
        );
      const forms = (await this.repo.formRecords.get(owner))?.data ?? {
        modules: [],
        checkins: {},
        habits: {},
      };
      const result = buildLearningReview(rows, input, forms);
      const workspace = await this.repo.getActionWorkspace(owner),
        tasks = await this.repo.listTasks(owner);
      for (const e of workspace?.data.records ?? [])
        if (
          e.record_kind === "session" &&
          e.outcome !== "running" &&
          e.actual_minutes > 0
        ) {
          const d = result.days.find((d) => d.date === e.business_date);
          if (d) d.action_minutes += e.actual_minutes;
        }
      for (const t of tasks)
        if (
          t.status === "completed" &&
          t.completedAt &&
          t.actualMinutes &&
          t.actualMinutes > 0
        ) {
          const d = result.days.find(
            (d) =>
              d.date === businessDateAt(new Date(t.completedAt!), timezone),
          );
          if (d) d.goal_minutes += t.actualMinutes;
        }
      const focus = await this.repo.focus.summary(
        owner,
        result.start,
        result.end,
      );
      return {
        ...result,
        private_coverage: authority.privateEnabled
          ? "included"
          : "not_authorized",
        snapshot_at: this.now().toISOString(),
        focus: {
          minutes: Math.round((focus.seconds / 60) * 100) / 100,
          recorded_days: focus.days,
        },
      };
    });
  }
}
