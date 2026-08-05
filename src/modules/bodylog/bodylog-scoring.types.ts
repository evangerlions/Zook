export interface BodyLogScoringHabit {
  habitId: string;
  scheduledDates: string[];
}

export interface BodyLogWeeklyGoalSnapshot {
  appId: string;
  userId: string;
  seasonLabel: string;
  timezone: string;
  habits: BodyLogScoringHabit[];
  scheduledInstanceCount: number;
  createdAt: string;
}

export interface BodyLogDailyAggregate {
  appId: string;
  userId: string;
  seasonLabel: string;
  date: string;
  completedHabitIds: string[];
  acceptedAt: string;
}

export interface BodyLogConsistencyResult {
  score: number;
  completionScore: number;
  consistencyScore: number;
  effectiveQualifiedDays: number;
  completedInstanceCount: number;
  eligibleForPublicRank: boolean;
  reachedAt: string;
}

export interface BodyLogLeaderboardEntryRecord extends BodyLogConsistencyResult {
  appId: string;
  userId: string;
  seasonLabel: string;
  optedIn: boolean;
  updatedAt: string;
}
