import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBodyLogConsistencyScore,
  compareBodyLogEntries,
} from "../../src/modules/bodylog/bodylog-scoring.rules.ts";
import type {
  BodyLogDailyAggregate,
  BodyLogWeeklyGoalSnapshot,
} from "../../src/modules/bodylog/bodylog-scoring.types.ts";

const dates = Array.from({ length: 7 }, (_, index) => `2026-07-${27 + index}`);
const snapshot: BodyLogWeeklyGoalSnapshot = {
  appId: "bodylog", userId: "alice", seasonLabel: "2026-W31", timezone: "Asia/Shanghai",
  habits: [{ habitId: "habit-a", scheduledDates: dates }],
  scheduledInstanceCount: 7, createdAt: "2026-07-27T00:00:00.000Z",
};

function aggregate(date: string, ids = ["habit-a", "habit-a"]): BodyLogDailyAggregate {
  return {
    appId: "bodylog", userId: "alice", seasonLabel: "2026-W31",
    date, completedHabitIds: ids, acceptedAt: `${date}T12:00:00.000Z`,
  };
}

test("score caps each habit at one instance per day and totals one hundred", () => {
  const result = calculateBodyLogConsistencyScore({
    snapshot, completed: dates.map((date) => aggregate(date)),
    reachedAt: "2026-08-02T12:00:00.000Z",
  });
  assert.deepEqual(result, {
    score: 100, completionScore: 80, consistencyScore: 20,
    effectiveQualifiedDays: 7, completedInstanceCount: 7,
    eligibleForPublicRank: true, reachedAt: "2026-08-02T12:00:00.000Z",
  });
});

test("two qualified days are not public-rank eligible", () => {
  const result = calculateBodyLogConsistencyScore({
    snapshot, completed: dates.slice(0, 2).map((date) => aggregate(date)),
    reachedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(result.eligibleForPublicRank, false);
  assert.equal(result.consistencyScore, 0);
});

test("rank tie-breaks by effective days, completed instances, then earliest reached time", () => {
  const base = {
    score: 80, completionScore: 72, consistencyScore: 8,
    effectiveQualifiedDays: 4, completedInstanceCount: 8,
    eligibleForPublicRank: true,
  };
  const earlier = { ...base, reachedAt: "2026-07-30T10:00:00.000Z" };
  const later = { ...base, reachedAt: "2026-07-30T11:00:00.000Z" };
  assert.equal(compareBodyLogEntries(earlier, later) < 0, true);
});
