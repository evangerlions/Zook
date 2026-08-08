import type {
  BodyLogConsistencyResult,
  BodyLogDailyAggregate,
  BodyLogWeeklyGoalSnapshot,
} from "./bodylog-scoring.types.ts";

export function consistencyBonus(days: number): number {
  return ({ 3: 5, 4: 8, 5: 12, 6: 16, 7: 20 } as Record<number, number>)[
    Math.min(Math.max(days, 0), 7)
  ] ?? 0;
}

export function calculateBodyLogConsistencyScore(input: {
  snapshot: BodyLogWeeklyGoalSnapshot;
  completed: BodyLogDailyAggregate[];
  reachedAt: string;
}): BodyLogConsistencyResult {
  const planned = new Set(
    input.snapshot.habits.flatMap((habit) =>
      habit.scheduledDates.map((date) => `${habit.habitId}:${date}`)),
  );
  const completed = new Set<string>();
  const qualifiedDates = new Set<string>();
  for (const aggregate of input.completed) {
    for (const habitId of new Set(aggregate.completedHabitIds)) {
      const key = `${habitId}:${aggregate.date}`;
      if (planned.has(key)) {
        completed.add(key);
        qualifiedDates.add(aggregate.date);
      }
    }
  }
  const scheduled = Math.max(input.snapshot.scheduledInstanceCount, planned.size, 1);
  const completionScore = Math.min(80, Math.round((completed.size / scheduled) * 80));
  const effectiveQualifiedDays = Math.min(qualifiedDates.size, 7);
  const consistencyScore = consistencyBonus(effectiveQualifiedDays);
  return {
    score: Math.min(100, completionScore + consistencyScore),
    completionScore,
    consistencyScore,
    effectiveQualifiedDays,
    completedInstanceCount: completed.size,
    eligibleForPublicRank: effectiveQualifiedDays >= 3,
    reachedAt: input.reachedAt,
  };
}

export function compareBodyLogEntries(
  left: BodyLogConsistencyResult,
  right: BodyLogConsistencyResult,
): number {
  return right.score - left.score ||
    right.effectiveQualifiedDays - left.effectiveQualifiedDays ||
    right.completedInstanceCount - left.completedInstanceCount ||
    left.reachedAt.localeCompare(right.reachedAt);
}
