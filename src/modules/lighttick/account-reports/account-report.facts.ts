import { createHash } from "node:crypto";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { collectReviewFacts } from "../knowledge/review.facts.ts";
import type { FormRecords } from "../form-records/form-records.types.ts";
import type { AccountReportFacts } from "./account-report.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
const DAY = 86400000;
const labels: Record<string, string> = {
  record: "随手记录",
  knowledge: "知识条目",
  cognition: "认知条目",
  learning_notes: "课程笔记/作答",
  lesson_completed: "明确学完课节",
  task_completed: "目标任务完成",
  action_completed: "行动完成确认",
  action_execution: "行动投入记录",
  practice_feedback: "自述实践反馈",
  reflection: "目标复盘",
  confirmed_insight: "已确认观察",
  reading_added: "收藏文章",
  reading_completed: "明确读完文章",
  reading_feedback: "阅读反馈",
  reading_task_completed: "阅读任务完成",
  decisions: "手工决策记录",
  predictions: "手工预测记录",
  reviews: "手工复盘记录",
  insights: "手工感悟记录",
  todos: "手工待办记录",
  customRecords: "自定义记录",
  investment_research: "投资研究记录",
  investment_predictions: "投资预测记录",
  investment_feedback: "投资复盘反馈",
};
interface Input {
  start: string;
  end: string;
  timezone: string;
  snapshot_at: string;
  facts: { kind: string; date: string | null }[];
  forms?: Partial<FormRecords>;
  extras?: { key: string; date: string | null }[];
  action_minutes: number;
  goal_minutes: number;
  action_days?: number;
  goal_days?: number;
  learning_authorized?: boolean;
  private_learning_authorized?: boolean;
}
export function summarizeAccountFacts(input: Input): AccountReportFacts {
  const within = (date: string | null | undefined): date is string =>
    !!date && date >= input.start && date <= input.end;
  const active = new Set<string>(),
    count = new Map<string, number>();
  let unknown = 0;
  for (const fact of [
    ...input.facts
      .filter((f) => f.kind !== "lesson")
      .map((f) => ({ key: f.kind, date: f.date })),
    ...(input.extras ?? []),
  ]) {
    if (!fact.date) {
      unknown++;
      continue;
    }
    if (!within(fact.date)) continue;
    count.set(fact.key, (count.get(fact.key) ?? 0) + 1);
    active.add(fact.date);
  }
  const forms = input.forms ?? {};
  const modules = (forms.modules ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    recorded_days: 0,
  }));
  for (const [date, values] of Object.entries(forms.checkins ?? {}))
    if (within(date)) {
      for (const module of modules)
        if (Number(values[module.id]) > 0) {
          module.recorded_days++;
          active.add(date);
        }
    }
  let habitMinutes = 0,
    habitDays = 0;
  for (const [date, value] of Object.entries(forms.habits ?? {}))
    if (within(date) && Number.isFinite(value.minutes) && value.minutes > 0) {
      habitMinutes += value.minutes;
      habitDays++;
      active.add(date);
    }
  for (const key of [
    "decisions",
    "predictions",
    "reviews",
    "insights",
    "todos",
    "customRecords",
  ] as const) {
    for (const row of forms[key] ?? []) {
      const date = typeof row.date === "string" ? row.date : null;
      if (!date) {
        unknown++;
        continue;
      }
      if (within(date)) {
        count.set(key, (count.get(key) ?? 0) + 1);
        active.add(date);
      }
    }
  }
  const facts: AccountReportFacts = {
    version: "account-facts-v1",
    start: input.start,
    end: input.end,
    period_days:
      Math.round((Date.parse(input.end) - Date.parse(input.start)) / DAY) + 1,
    timezone: input.timezone,
    snapshot_at: input.snapshot_at,
    active_days: active.size,
    unknown_date_count: unknown,
    metrics: Object.entries(labels).map(([key, label]) => ({
      key,
      label,
      count: count.get(key) ?? 0,
      coverage:
        key === "learning_notes" && !input.private_learning_authorized
          ? "not_authorized"
          : key === "lesson_completed" &&
              (!input.learning_authorized || !input.private_learning_authorized)
            ? "partial"
            : "included",
      date_basis: [
        "record",
        "decisions",
        "predictions",
        "reviews",
        "insights",
        "todos",
        "customRecords",
      ].includes(key)
        ? "record_date"
        : key === "action_execution"
          ? "business_date"
          : "source_event_or_saved_timestamp",
    })),
    modules,
    durations: [
      {
        key: "manual_habits",
        label: "手工习惯补记",
        minutes: habitMinutes,
        recorded_days: habitDays,
      },
      {
        key: "actions",
        label: "行动会话投入",
        minutes: input.action_minutes,
        recorded_days: input.action_days ?? 0,
      },
      {
        key: "goals",
        label: "目标任务实报投入",
        minutes: input.goal_minutes,
        recorded_days: input.goal_days ?? 0,
      },
    ],
    limitations: [
      "仅统计本期已保存且可访问的记录；没有记录不代表没有活动。",
      "学完、读完、行动完成、任务完成与自述实践分别计数，可能重叠，不代表能力掌握或实际效果。",
      "各时长来源可能重叠，不能相加为总学习时长；不含未接入的课程计时。",
      "单期汇总无法证明趋势、原因、预测校准或行为改变；不提供无样本的准确率。",
      "未知日期的记录单独计数，不强行计入本期；归档内容不参与新的快照。",
      ...(!input.learning_authorized
        ? ["课程阅读未授权或未迁入 Zook，课程指标不代表完整账户。"]
        : []),
      ...(!input.private_learning_authorized
        ? ["私人学习未授权，私人笔记与学完状态未纳入。"]
        : []),
    ],
    digest: "",
  };
  facts.digest = createHash("sha256")
    .update(JSON.stringify(facts))
    .digest("hex");
  return facts;
}
export async function collectAccountReportFacts(
  repo: LightTickRepository,
  owner: LightTickOwner,
  days: number,
  instant: Date,
): Promise<AccountReportFacts> {
  const timezone = (await repo.getProfile(owner))?.timezone ?? "UTC",
    end = businessDateAt(instant, timezone),
    start = new Date(Date.parse(end) - (days - 1) * DAY)
      .toISOString()
      .slice(0, 10);
  const snapshot = await collectReviewFacts(repo, owner, timezone),
    forms = await repo.formRecords.get(owner),
    authority = await repo.getLearningAuthority(owner);
  const articles = await repo.listReadingArticles(owner),
    states = await repo.listReadingStates(owner),
    feedback = await repo.listReadingFeedback(owner),
    workspace = await repo.getActionWorkspace(owner);
  const research = await repo.investments.research.list(owner),
    predictions = await repo.investments.observations.list(
      owner,
      "predictions",
    ),
    investmentFeedback = await repo.investments.observations.list(
      owner,
      "feedback",
    );
  for (const rows of [
    articles,
    states,
    feedback,
    research,
    predictions,
    investmentFeedback,
  ])
    if (rows.length > 5000)
      throw new ApplicationError(
        413,
        "REQ_FIELD_INVALID",
        "账户报告单域超过 5000 条，请使用更大的索引投影。",
      );
  const date = (value: string | null | undefined) =>
    value ? businessDateAt(new Date(value), timezone) : null;
  const extras = [
    ...articles.map((a) => ({ key: "reading_added", date: date(a.createdAt) })),
    ...states
      .filter((s) => s.completedAt)
      .map((s) => ({ key: "reading_completed", date: date(s.completedAt) })),
    ...feedback
      .filter(
        (f) =>
          f.valueRating !== null ||
          f.difficulty !== null ||
          f.takeaway.trim() ||
          f.question.trim() ||
          f.application.trim() ||
          f.tags.length,
      )
      .map((f) => ({ key: "reading_feedback", date: date(f.updatedAt) })),
    ...research
      .filter((r) => !r.archived)
      .map((r) => ({ key: "investment_research", date: date(r.updated_at) })),
    ...predictions
      .filter((r) => !r.archived)
      .map((r) => ({
        key: "investment_predictions",
        date: date(r.created_at),
      })),
    ...investmentFeedback
      .filter((r) => !r.archived)
      .map((r) => ({ key: "investment_feedback", date: date(r.created_at) })),
  ];
  // Reading tasks use their scheduled business dates, not the latest title/version edit time.
  const readingTasks = await repo.listReadingEntries(owner, "task", {
    start,
    end,
    limit: 5001,
  });
  if (readingTasks.length > 5000)
    throw new ApplicationError(
      413,
      "REQ_FIELD_INVALID",
      "本期阅读任务超出报告容量。",
    );
  for (const task of readingTasks)
    if (task.status === "completed")
      extras.push({ key: "reading_task_completed", date: task.business_date });

  const within = (day: string) => day >= start && day <= end;
  const sessions = (workspace?.data.records ?? []).filter(
    (r) =>
      r.record_kind === "session" &&
      r.outcome !== "running" &&
      within(r.business_date),
  );
  const events = (
    await repo.listExecutionEvents(
      owner,
      new Date(Date.parse(start) - 2 * DAY).toISOString(),
      new Date(Date.parse(end) + 3 * DAY).toISOString(),
    )
  ).filter(
    (e) => e.eventType === "task_complete" && within(date(e.occurredAt)!),
  );
  return summarizeAccountFacts({
    start,
    end,
    timezone,
    snapshot_at: instant.toISOString(),
    facts: snapshot.facts,
    forms: forms?.data,
    extras,
    action_minutes: sessions.reduce(
      (sum, s) => sum + Math.max(0, s.actual_minutes ?? 0),
      0,
    ),
    goal_minutes: events.reduce(
      (sum, e) =>
        sum +
        (typeof e.payload.actual_minutes === "number"
          ? Math.max(0, e.payload.actual_minutes)
          : 0),
      0,
    ),
    action_days: new Set(sessions.map((s) => s.business_date)).size,
    goal_days: new Set(
      events
        .filter(
          (e) =>
            typeof e.payload.actual_minutes === "number" &&
            e.payload.actual_minutes > 0,
        )
        .map((e) => date(e.occurredAt)),
    ).size,
    learning_authorized:
      authority?.phase === "zook" && authority.readingEnabled,
    private_learning_authorized: authority?.privateEnabled,
  });
}
