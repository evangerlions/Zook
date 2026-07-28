import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type { BodyLogProfileService } from "./bodylog-profile.service.ts";
import {
  calculateBodyLogConsistencyScore,
  compareBodyLogEntries,
} from "./bodylog-scoring.rules.ts";
import type {
  BodyLogLeaderboardEntryRecord,
  BodyLogScoringHabit,
} from "./bodylog-scoring.types.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function currentBodyLogSeasonLabel(now = new Date(), timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export class BodyLogLeaderboardService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly profiles: BodyLogProfileService,
  ) {}

  async join(userId: string, input: {
    seasonLabel: unknown;
    timezone: unknown;
    habits: unknown;
  }) {
    const timezone = this.validTimezone(input.timezone);
    const seasonLabel = currentBodyLogSeasonLabel(new Date(), timezone);
    if (input.seasonLabel !== seasonLabel) {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Current season is required.");
    }
    const habits = this.validHabits(input.habits, seasonLabel);
    const existing = await this.database.findBodyLogWeeklyGoalSnapshot(
      BODYLOG_APP_ID, userId, seasonLabel,
    );
    const snapshot = existing ?? await this.database.upsertBodyLogWeeklyGoalSnapshot({
      appId: BODYLOG_APP_ID,
      userId,
      seasonLabel,
      timezone,
      habits,
      scheduledInstanceCount: habits.reduce(
        (sum, habit) => sum + habit.scheduledDates.length, 0,
      ),
      createdAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    const previous = await this.database.findBodyLogLeaderboardEntry(
      BODYLOG_APP_ID, userId, seasonLabel,
    );
    const entry = await this.database.upsertBodyLogLeaderboardEntry({
      appId: BODYLOG_APP_ID, userId, seasonLabel,
      score: previous?.score ?? 0,
      completionScore: previous?.completionScore ?? 0,
      consistencyScore: previous?.consistencyScore ?? 0,
      effectiveQualifiedDays: previous?.effectiveQualifiedDays ?? 0,
      completedInstanceCount: previous?.completedInstanceCount ?? 0,
      eligibleForPublicRank: previous?.eligibleForPublicRank ?? false,
      reachedAt: previous?.reachedAt ?? now,
      optedIn: true,
      updatedAt: now,
    });
    return { seasonLabel, timezone: snapshot.timezone, membership: this.membership(entry) };
  }

  async submitAggregate(userId: string, input: {
    seasonLabel: unknown;
    date: unknown;
    completedHabitIds: unknown;
  }) {
    if (typeof input.seasonLabel !== "string" || typeof input.date !== "string" ||
        !DATE_PATTERN.test(input.date) || !Array.isArray(input.completedHabitIds) ||
        input.completedHabitIds.some((item) => typeof item !== "string")) {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_AGGREGATE_INVALID", "Daily aggregate is invalid.");
    }
    const snapshot = await this.database.findBodyLogWeeklyGoalSnapshot(
      BODYLOG_APP_ID, userId, input.seasonLabel,
    );
    const entry = await this.database.findBodyLogLeaderboardEntry(
      BODYLOG_APP_ID, userId, input.seasonLabel,
    );
    if (!snapshot || !entry?.optedIn) {
      throw new ApplicationError(409, "BODYLOG_LEADERBOARD_NOT_JOINED", "Join the leaderboard first.");
    }
    if (!snapshot.habits.some((habit) => habit.scheduledDates.includes(input.date))) {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_AGGREGATE_INVALID", "Date is outside the weekly snapshot.");
    }
    const allowed = new Set(snapshot.habits.map((habit) => habit.habitId));
    const completedHabitIds = [...new Set(input.completedHabitIds)]
      .filter((habitId): habitId is string => typeof habitId === "string" && allowed.has(habitId));
    const now = new Date().toISOString();
    await this.database.upsertBodyLogDailyAggregate({
      appId: BODYLOG_APP_ID, userId, seasonLabel: input.seasonLabel,
      date: input.date, completedHabitIds, acceptedAt: now,
    });
    const aggregates = await this.database.listBodyLogDailyAggregates(
      BODYLOG_APP_ID, userId, input.seasonLabel,
    );
    const provisional = calculateBodyLogConsistencyScore({
      snapshot, completed: aggregates, reachedAt: now,
    });
    const result = {
      ...provisional,
      reachedAt: provisional.score === entry.score ? entry.reachedAt : now,
    };
    const updated = await this.database.upsertBodyLogLeaderboardEntry({
      ...entry, ...result, updatedAt: now,
    });
    return this.membership(updated);
  }

  async leave(userId: string, timezone: unknown) {
    const zone = this.validTimezone(timezone);
    const seasonLabel = currentBodyLogSeasonLabel(new Date(), zone);
    const entry = await this.database.findBodyLogLeaderboardEntry(
      BODYLOG_APP_ID, userId, seasonLabel,
    );
    if (entry) {
      await this.database.upsertBodyLogLeaderboardEntry({
        ...entry, optedIn: false, updatedAt: new Date().toISOString(),
      });
    }
    return { joined: false, seasonLabel };
  }

  async publicBoard(viewerUserId: string, timezone: unknown) {
    return await this.board(viewerUserId, timezone, "public");
  }

  async friendBoard(viewerUserId: string, timezone: unknown) {
    return await this.board(viewerUserId, timezone, "friends");
  }

  private async board(viewerUserId: string, timezone: unknown, scope: "public" | "friends") {
    const zone = this.validTimezone(timezone);
    const seasonLabel = currentBodyLogSeasonLabel(new Date(), zone);
    const all = await this.database.listBodyLogLeaderboardEntries(BODYLOG_APP_ID, seasonLabel);
    const blocks = await this.database.listBodyLogBlocks(BODYLOG_APP_ID);
    const blocked = new Set(blocks.filter((item) =>
      item.blockerUserId === viewerUserId || item.blockedUserId === viewerUserId)
      .map((item) => item.blockerUserId === viewerUserId ? item.blockedUserId : item.blockerUserId));
    let allowedIds: Set<string> | undefined;
    if (scope === "friends") {
      const friendships = await this.database.listBodyLogFriendships(BODYLOG_APP_ID);
      allowedIds = new Set([viewerUserId, ...friendships.filter((item) =>
        item.userId === viewerUserId || item.friendUserId === viewerUserId)
        .map((item) => item.userId === viewerUserId ? item.friendUserId : item.userId)]);
    }
    const ranked = all.filter((item) =>
      item.optedIn && item.eligibleForPublicRank && !blocked.has(item.userId) &&
      (!allowedIds || allowedIds.has(item.userId)))
      .sort(compareBodyLogEntries);
    const entries = await Promise.all(ranked.map(async (entry, index) => {
      const profile = await this.profiles.getOrCreate(entry.userId);
      return {
        rank: index + 1, userId: entry.userId, nickname: profile.nickname,
        avatarKey: profile.avatarKey, score: entry.score,
        effectiveDays: entry.effectiveQualifiedDays,
        completedInstances: entry.completedInstanceCount,
      };
    }));
    const own = all.find((item) => item.userId === viewerUserId);
    return {
      seasonLabel, status: "live", scope, entries,
      membership: own ? this.membership(own) : { joined: false, eligible: false, effectiveDays: 0, score: 0 },
      updatedAt: new Date().toISOString(),
    };
  }

  private membership(entry: BodyLogLeaderboardEntryRecord) {
    return {
      joined: entry.optedIn, eligible: entry.eligibleForPublicRank,
      effectiveDays: entry.effectiveQualifiedDays, score: entry.score,
    };
  }

  private validTimezone(raw: unknown): string {
    if (typeof raw !== "string") {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Time zone is required.");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: raw }).format();
      return raw;
    } catch {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Time zone is invalid.");
    }
  }

  private validHabits(raw: unknown, seasonLabel: string): BodyLogScoringHabit[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Select one to five habits.");
    }
    const habits = raw.map((item) => {
      const value = item as Record<string, unknown>;
      if (typeof value?.habitId !== "string" || !Array.isArray(value.scheduledDates)) {
        throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Habit schedule is invalid.");
      }
      const dates = [...new Set(value.scheduledDates)];
      if (dates.some((date) => typeof date !== "string" || !DATE_PATTERN.test(date) ||
          seasonForCalendarDate(date) !== seasonLabel)) {
        throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "Scheduled date is invalid.");
      }
      return { habitId: value.habitId, scheduledDates: dates as string[] };
    });
    if (new Set(habits.map((habit) => habit.habitId)).size !== habits.length ||
        new Set(habits.flatMap((habit) => habit.scheduledDates)).size < 3) {
      throw new ApplicationError(400, "BODYLOG_LEADERBOARD_SNAPSHOT_INVALID", "At least three target days are required.");
    }
    return habits;
  }
}

function seasonForCalendarDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
