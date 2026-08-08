import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

export function buildFocusWeekStats(sessions: FrogSleepEntityRecord[], since: string) {
  const totalMinutes = sessions.reduce((sum, item) => sum + Number(item.payload.minutes ?? 0), 0);
  const days = new Set(sessions.map((item) => (item.startsAt ?? item.createdAt).slice(0, 10)));
  const completedCount = sessions.filter((item) => item.status === "completed").length;
  const longestSessionMinutes = sessions.reduce((max, item) => Math.max(max, Number(item.payload.minutes ?? 0)), 0);
  const goalCounts = new Map<string, number>();
  for (const item of sessions) {
    const goal = item.payload.goal_tag ?? item.payload.goal;
    if (goal) {
      const key = String(goal);
      goalCounts.set(key, (goalCounts.get(key) ?? 0) + 1);
    }
  }
  const topGoalTag = [...goalCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  return {
    week_start: since,
    total_minutes: totalMinutes,
    session_count: sessions.length,
    completed_count: completedCount,
    active_days: days.size,
    streak_days: days.size,
    longest_streak: days.size,
    top_goal_tag: topGoalTag,
    completion_rate: sessions.length > 0 ? completedCount / sessions.length : 0,
    longest_session_minutes: longestSessionMinutes,
    daily: [...days].sort().map((date) => ({
      date,
      minutes: sessions
        .filter((item) => (item.startsAt ?? item.createdAt).startsWith(date))
        .reduce((sum, item) => sum + Number(item.payload.minutes ?? 0), 0),
      session_count: sessions
        .filter((item) => (item.startsAt ?? item.createdAt).startsWith(date)).length,
    })),
  };
}
