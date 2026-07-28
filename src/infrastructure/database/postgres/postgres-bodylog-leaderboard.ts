import type {
  BodyLogDailyAggregate,
  BodyLogLeaderboardEntryRecord,
  BodyLogWeeklyGoalSnapshot,
} from "../../../modules/bodylog/bodylog-scoring.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export class PostgresBodyLogLeaderboardStore {
  constructor(private readonly query: Query) {}

  async findSnapshot(appId: string, userId: string, seasonLabel: string) {
    const result = await this.query(
      `SELECT app_id, user_id, season_label, timezone, snapshot, created_at
       FROM zook_bodylog_weekly_goal_snapshots
       WHERE app_id = $1 AND user_id = $2 AND season_label = $3`,
      [appId, userId, seasonLabel],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const snapshot = row.snapshot as { habits: BodyLogWeeklyGoalSnapshot["habits"]; scheduledInstanceCount: number };
    return {
      appId: String(row.app_id), userId: String(row.user_id),
      seasonLabel: String(row.season_label), timezone: String(row.timezone),
      habits: snapshot.habits, scheduledInstanceCount: snapshot.scheduledInstanceCount,
      createdAt: iso(row.created_at),
    } satisfies BodyLogWeeklyGoalSnapshot;
  }

  async upsertSnapshot(record: BodyLogWeeklyGoalSnapshot) {
    await this.query(
      `INSERT INTO zook_bodylog_weekly_goal_snapshots
       (app_id, user_id, season_label, timezone, snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (app_id, user_id, season_label) DO NOTHING`,
      [record.appId, record.userId, record.seasonLabel, record.timezone,
        JSON.stringify({ habits: record.habits, scheduledInstanceCount: record.scheduledInstanceCount }),
        record.createdAt],
    );
    return (await this.findSnapshot(record.appId, record.userId, record.seasonLabel)) ?? record;
  }

  async listAggregates(appId: string, userId: string, seasonLabel: string) {
    const result = await this.query(
      `SELECT app_id, user_id, season_label, aggregate_date, completed_habit_ids, accepted_at
       FROM zook_bodylog_daily_aggregates
       WHERE app_id = $1 AND user_id = $2 AND season_label = $3`,
      [appId, userId, seasonLabel],
    );
    return result.rows.map((row) => ({
      appId: String(row.app_id), userId: String(row.user_id),
      seasonLabel: String(row.season_label),
      date: iso(row.aggregate_date).slice(0, 10),
      completedHabitIds: row.completed_habit_ids as string[],
      acceptedAt: iso(row.accepted_at),
    } satisfies BodyLogDailyAggregate));
  }

  async upsertAggregate(record: BodyLogDailyAggregate) {
    await this.query(
      `INSERT INTO zook_bodylog_daily_aggregates
       (app_id, user_id, season_label, aggregate_date, completed_habit_ids, accepted_at)
       VALUES ($1, $2, $3, $4::date, $5::jsonb, $6::timestamptz)
       ON CONFLICT (app_id, user_id, season_label, aggregate_date)
       DO UPDATE SET completed_habit_ids = EXCLUDED.completed_habit_ids,
         accepted_at = EXCLUDED.accepted_at`,
      [record.appId, record.userId, record.seasonLabel, record.date,
        JSON.stringify(record.completedHabitIds), record.acceptedAt],
    );
    return record;
  }

  async findEntry(appId: string, userId: string, seasonLabel: string) {
    const entries = await this.listEntries(appId, seasonLabel);
    return entries.find((item) => item.userId === userId);
  }

  async upsertEntry(record: BodyLogLeaderboardEntryRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_leaderboard_entries
       (app_id, user_id, season_label, score, completion_score, consistency_score,
        effective_days, completed_instances, eligible_public, reached_at, opted_in, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12::timestamptz)
       ON CONFLICT (app_id, user_id, season_label) DO UPDATE SET
         score = EXCLUDED.score, completion_score = EXCLUDED.completion_score,
         consistency_score = EXCLUDED.consistency_score, effective_days = EXCLUDED.effective_days,
         completed_instances = EXCLUDED.completed_instances,
         eligible_public = EXCLUDED.eligible_public, reached_at = EXCLUDED.reached_at,
         opted_in = EXCLUDED.opted_in, updated_at = EXCLUDED.updated_at`,
      [record.appId, record.userId, record.seasonLabel, record.score,
        record.completionScore, record.consistencyScore, record.effectiveQualifiedDays,
        record.completedInstanceCount, record.eligibleForPublicRank, record.reachedAt,
        record.optedIn, record.updatedAt],
    );
    return record;
  }

  async listEntries(appId: string, seasonLabel: string): Promise<BodyLogLeaderboardEntryRecord[]> {
    const result = await this.query(
      `SELECT app_id, user_id, season_label, score, completion_score, consistency_score,
        effective_days, completed_instances, eligible_public, reached_at, opted_in, updated_at
       FROM zook_bodylog_leaderboard_entries WHERE app_id = $1 AND season_label = $2`,
      [appId, seasonLabel],
    );
    return result.rows.map((row) => ({
      appId: String(row.app_id), userId: String(row.user_id),
      seasonLabel: String(row.season_label), score: Number(row.score),
      completionScore: Number(row.completion_score),
      consistencyScore: Number(row.consistency_score),
      effectiveQualifiedDays: Number(row.effective_days),
      completedInstanceCount: Number(row.completed_instances),
      eligibleForPublicRank: Boolean(row.eligible_public),
      reachedAt: iso(row.reached_at), optedIn: Boolean(row.opted_in),
      updatedAt: iso(row.updated_at),
    }));
  }
}
