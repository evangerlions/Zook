import { businessDateAt } from "../lighttick-today.service.ts";

/**
 * 成长总览聚合。
 *
 * 旧版「成长总览」包含本周各模块投入度、4 个月热力图、近 7 天。
 * 新版不新建实体：任务表已经带了排期、完成时间、预估与实测时长，
 * 聚合即可还原「什么时候投入了多少」。
 *
 * 两个口径必须分开，否则数字会自相矛盾：
 *   - **计划** 按 `scheduledFor` 归日：那件事被安排在哪天；
 *   - **完成** 按 `completedAt` 归日：那件事实际在哪天做完。
 * 未完成的任务只进计划口径，不进完成口径；取消的任务两边都不算。
 *
 * 时长优先用 `actualMinutes`（实测），缺失才退回 `estimatedMinutes`（预估）。
 * 预估冒充实测会让「投入度」虚高，所以输出里同时给出两个字段，
 * 由界面决定怎么表达，聚合层不做无依据的四舍五入。
 */

export interface GrowthTaskInput {
  status: string;
  scheduledFor?: string;
  completedAt?: string;
  estimatedMinutes: number | null;
  actualMinutes?: number;
}

export interface GrowthDayBucket {
  date: string;
  completed: number;
  minutes: number;
  planned: number;
}

export interface GrowthOverview {
  today: string;
  timezone: string;
  week: {
    start: string;
    end: string;
    planned: number;
    completed: number;
    minutes: number;
    days: GrowthDayBucket[];
  };
  recent: {
    start: string;
    end: string;
    completed: number;
    minutes: number;
    days: GrowthDayBucket[];
  };
  heatmap: {
    start: string;
    end: string;
    days: Array<{ date: string; completed: number; minutes: number }>;
  };
  totals: {
    completed: number;
    minutes: number;
    active_days: number;
    current_streak: number;
    longest_streak: number;
  };
}

const DAY_MS = 86_400_000;

/** 把 ISO 时间戳或 YYYY-MM-DD 统一成用户时区下的业务日。 */
export function businessDayOf(value: string | undefined, timezone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? businessDateAt(parsed, timezone) : null;
}

export function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 周一为一周第一天（与旧版周报口径一致）。 */
export function startOfWeek(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay(); // 0=周日
  return addDays(day, -((weekday + 6) % 7));
}

function emptyDay(date: string): GrowthDayBucket {
  return { date, completed: 0, minutes: 0, planned: 0 };
}

export function buildGrowthOverview(
  tasks: GrowthTaskInput[],
  input: { today: string; timezone: string; heatmapDays?: number },
): GrowthOverview {
  const heatmapDays = Math.max(1, input.heatmapDays ?? 120);
  const heatmapStart = addDays(input.today, -(heatmapDays - 1));
  const weekStart = startOfWeek(input.today);
  const weekEnd = addDays(weekStart, 6);
  const recentStart = addDays(input.today, -6);

  const planned = new Map<string, number>();
  const completed = new Map<string, number>();
  const minutes = new Map<string, number>();

  for (const task of tasks) {
    if (task.status === "cancelled") continue;
    const plannedDay = businessDayOf(task.scheduledFor, input.timezone);
    if (plannedDay) planned.set(plannedDay, (planned.get(plannedDay) ?? 0) + 1);

    if (task.status !== "completed") continue;
    const doneDay = businessDayOf(task.completedAt, input.timezone) ?? plannedDay;
    if (!doneDay) continue;
    completed.set(doneDay, (completed.get(doneDay) ?? 0) + 1);
    minutes.set(
      doneDay,
      (minutes.get(doneDay) ?? 0) + (task.actualMinutes ?? task.estimatedMinutes ?? 0),
    );
  }

  const dayBucket = (date: string): GrowthDayBucket => ({
    date,
    completed: completed.get(date) ?? 0,
    minutes: minutes.get(date) ?? 0,
    planned: planned.get(date) ?? 0,
  });
  const range = (start: string, end: string): string[] => {
    const days: string[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
    return days;
  };

  const weekDays = range(weekStart, weekEnd).map(dayBucket);
  const recentDays = range(recentStart, input.today).map(dayBucket);
  const heatmapRange = range(heatmapStart, input.today);

  // 连续天数：从今天往回数有完成记录的日子；今天还没完成时从昨天起算，
  // 这样「今天还没开始」不会被显示成「连续中断」。
  let cursor = (completed.get(input.today) ?? 0) > 0 ? input.today : addDays(input.today, -1);
  let currentStreak = 0;
  while ((completed.get(cursor) ?? 0) > 0) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }
  let longestStreak = 0;
  let running = 0;
  for (const day of heatmapRange) {
    if ((completed.get(day) ?? 0) > 0) {
      running += 1;
      longestStreak = Math.max(longestStreak, running);
    } else running = 0;
  }

  const sum = (map: Map<string, number>, days: string[]) =>
    days.reduce((total, day) => total + (map.get(day) ?? 0), 0);

  return {
    today: input.today,
    timezone: input.timezone,
    week: {
      start: weekStart,
      end: weekEnd,
      planned: sum(planned, range(weekStart, weekEnd)),
      completed: sum(completed, range(weekStart, weekEnd)),
      minutes: sum(minutes, range(weekStart, weekEnd)),
      days: weekDays,
    },
    recent: {
      start: recentStart,
      end: input.today,
      completed: sum(completed, range(recentStart, input.today)),
      minutes: sum(minutes, range(recentStart, input.today)),
      days: recentDays,
    },
    heatmap: {
      start: heatmapStart,
      end: input.today,
      days: heatmapRange.map((date) => ({
        date,
        completed: completed.get(date) ?? 0,
        minutes: minutes.get(date) ?? 0,
      })),
    },
    totals: {
      completed: sum(completed, heatmapRange),
      minutes: sum(minutes, heatmapRange),
      active_days: heatmapRange.filter((day) => (completed.get(day) ?? 0) > 0).length,
      current_streak: currentStreak,
      longest_streak: longestStreak,
    },
  };
}
