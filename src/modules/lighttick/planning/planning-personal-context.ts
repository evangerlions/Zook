import type { LightTickRepository } from "../lighttick.repository.ts";
import { taskScheduledDate } from "../lighttick-today.service.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { subjectIdForPlan } from "./goal-subjects.ts";
import type { ExistingPlanReview, PlanningContext, PlanningField, PlanningMode, PlanningSession } from "./planning.types.ts";

export const EXISTING_PLAN_MAX_LENGTH = 2500;
export const EXISTING_PLAN_MAX_LINES = 40;
export const MAX_PLANNING_QUESTIONS = 3;

const FACT_FIELDS = [
  "objective", "outcome", "experience", "available_minutes", "period_start", "period_end", "constraints", "materials", "identity",
] as const satisfies readonly PlanningField[];

export function unknownPlanningFields(context: PlanningContext) {
  return FACT_FIELDS.filter(key => !context[key] || context[key].source === "assumption");
}

export function recommendPlanningMode(context: PlanningContext, targetDate?: string): { mode: PlanningMode; reason: string } {
  const topic = [context.objective?.value, context.outcome?.value].join(" ").toLowerCase();
  if (dateOnly(targetDate)) return { mode: "deadline", reason: "这个目标已有明确截止日，可以从日期倒排准备。" };
  if (/考试|考证|截止|考研|考公|\bexam\b|\bdeadline\b|\bcertification\b/u.test(topic))
    return { mode: "deadline", reason: "你的目标涉及考试、证书或截止日期，可以先核对日期再安排准备。" };
  if (/探索|方向|选专业|考虑转行|职业选择|是否适合|\bexplor(?:e|ation)\b|\bcareer chang/u.test(topic))
    return { mode: "exploration", reason: "你想先弄清哪个方向适合自己，可以用小体验帮助选择。" };
  if (/习惯|每天|每日|每周坚持|冥想|规律|\bhabit\b|\bdaily\b|\broutine\b/u.test(topic))
    return { mode: "routine", reason: "这件事适合安排能坚持的小行动和休息节奏。" };
  if (/交付|发布|完成作品|做出|上线|论文|项目|\bproject\b|\bdeliver\b|\blaunch\b/u.test(topic))
    return { mode: "project", reason: "你的目标有可交付的结果，可以把它拆成几个可核对的阶段。" };
  return { mode: "skill", reason: "可以从一次短练习开始，再根据表现调整下一步。" };
}

export function originalPlanLines(plan: string) {
  return plan.split(/\r\n|\n|\r/u).flatMap((text, index) => text.trim()
    ? [{ line_number: index + 1, text }] : []);
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function titleFromLine(value: string) {
  return normalizeTitle(value.normalize("NFKC").trim()
    .replace(/^(?:[-*+•]\s*|\d{1,3}[.)、]\s*)/u, "")
    .replace(/\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/\d+\s*(?:分钟|min(?:ute)?s?\b)/giu, ""));
}

function explicitPlanDetails(text: string) {
  const normalized = text.normalize("NFKC");
  const dates = [...new Set(normalized.match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/gu) ?? [])];
  const counts = [...normalized.matchAll(/(?<![\d.,])\d{1,4}\s*(?:分钟|min(?:ute)?s?\b)/giu)];
  const stated = counts[0];
  const minutes = stated && !/\d\s*[-–—~至到]\s*$/u.test(normalized.slice(0, stated.index))
    ? Number(stated[0].match(/^\d+/u)?.[0]) : null;
  return {
    source_date: dates.length === 1 && dateOnly(dates[0]) ? dates[0] : null,
    estimated_minutes: counts.length === 1 && minutes !== null && minutes >= 1 && minutes <= 1440 ? minutes : null,
  };
}

export async function reviewExistingPlan(repository: LightTickRepository, session: PlanningSession): Promise<ExistingPlanReview | undefined> {
  const source = session.context.existing_plan;
  if (source?.source !== "imported" || typeof source.value !== "string") return undefined;
  const plans = await repository.listPlans(session, session.goalId);
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  const timezone = (await repository.getProfile(session))?.timezone ?? "UTC";
  const canReadLearning = canReadNativeLearning(await repository.getLearningAuthority(session));
  const inventory = (await repository.listTasks(session)).flatMap(task => {
    const plan = byId.get(task.planId);
    if (!plan || task.goalId !== session.goalId || (task.lessonSource && !canReadLearning) ||
      (session.subjectId && subjectIdForPlan(plan) !== session.subjectId))
      return [];
    if ((plan.status !== "active" || !["pending", "in_progress", "completed"].includes(task.status)) &&
      !(plan.status === "superseded" && task.status === "completed")) return [];
    return [{ task_id: task.id, title: task.title, scheduled_date: taskScheduledDate(task, timezone) ?? null }];
  });
  const byTitle = new Map<string, typeof inventory>();
  for (const item of inventory) {
    const title = normalizeTitle(item.title);
    if (!title) continue;
    const matches = byTitle.get(title) ?? [];
    matches.push(item);
    byTitle.set(title, matches);
  }
  return {
    lines: originalPlanLines(source.value).map(line => {
      const details = explicitPlanDetails(line.text);
      const matches = byTitle.get(titleFromLine(line.text)) ?? [];
      return { ...line, ...details,
        likely_duplicates: matches.filter(task => !details.source_date || task.scheduled_date === details.source_date).slice(0, 3) };
    }),
  };
}
