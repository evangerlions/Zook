import type { AdminGrowthPlanDetails, AdminNotificationConfig, AdminScoringConfig, AdminSeasonConfig } from "../../../modules/bodylog/bodylog-admin.types.ts";
import type { GrowthPlanStatus } from "../../../modules/bodylog/bodylog-growth.types.ts";
import type {
  AdminFeatureFlagAnalytics,
  AdminGrowthPlan,
  AdminGrowthStatistics,
  AdminReward,
  AdminRewardStatistics,
} from "../../../modules/bodylog/bodylog-admin.types.ts";
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export class PostgresBodyLogGrowthAdminStore {
  constructor(private readonly query: Query) {}

  // ===== Growth Plan Management =====

  async listGrowthPlansPaginated(
    offset: number,
    limit: number,
  ): Promise<{ plans: AdminGrowthPlan[]; total: number }> {
    const [plansResult, countResult] = await Promise.all([
      this.query(
        `SELECT gp.id, gp.user_id, gp.status, gp.start_date, gp.end_date,
                gp.completed_missions, gp.total_missions,
                p.nickname
         FROM bodylog_seven_day_plans gp
         LEFT JOIN zook_bodylog_profiles p ON p.app_id = 'bodylog' AND p.user_id = gp.user_id
         ORDER BY gp.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM bodylog_seven_day_plans"),
    ]);

    const plans: AdminGrowthPlan[] = plansResult.rows.map((row) => ({
      planId: String(row.id),
      userId: String(row.user_id),
      nickname: String(row.nickname ?? "unknown"),
      status: String(row.status) as AdminGrowthPlan["status"],
      startDate: iso(row.start_date),
      endDate: iso(row.end_date),
      completedMissions: Number(row.completed_missions),
      totalMissions: Number(row.total_missions),
    }));

    return { plans, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async getGrowthStatistics(): Promise<AdminGrowthStatistics> {
    const result = await this.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         AVG(CASE WHEN status = 'completed' THEN completed_missions::float / NULLIF(total_missions, 0) END) AS avg_rate
       FROM bodylog_seven_day_plans`,
    );
    const row = result.rows[0];
    return {
      totalPlans: Number(row?.total ?? 0),
      activePlans: Number(row?.active ?? 0),
      completedPlans: Number(row?.completed ?? 0),
      avgCompletionRate: Number(row?.avg_rate ?? 0),
    };
  }

  // ===== Reward Management =====

  async listRewardsPaginated(
    offset: number,
    limit: number,
  ): Promise<{ rewards: AdminReward[]; total: number }> {
    const [rewardsResult, countResult] = await Promise.all([
      this.query(
        `SELECT id, plan_id, type, value, claimed, claimed_at, created_at
         FROM bodylog_rewards
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM bodylog_rewards"),
    ]);

    const rewards: AdminReward[] = rewardsResult.rows.map((row) => ({
      rewardId: String(row.id),
      planId: String(row.plan_id),
      userId: "",
      type: String(row.type),
      value: String(row.value),
      claimed: Boolean(row.claimed),
      claimedAt: row.claimed_at ? iso(row.claimed_at) : null,
      createdAt: iso(row.created_at),
    }));

    return { rewards, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async getRewardStatistics(): Promise<AdminRewardStatistics> {
    const result = await this.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE claimed = true)::int AS claimed
       FROM bodylog_rewards`,
    );
    const row = result.rows[0];
    const total = Number(row?.total ?? 0);
    const claimed = Number(row?.claimed ?? 0);
    return {
      totalRewards: total,
      claimedRewards: claimed,
      claimRate: total > 0 ? claimed / total : 0,
    };
  }

  // ===== Feature Flag Analytics =====

  async getFeatureFlagAnalytics(): Promise<AdminFeatureFlagAnalytics[]> {
    const flags = await this.query("SELECT * FROM bodylog_feature_flags ORDER BY key ASC");
    const analytics: AdminFeatureFlagAnalytics[] = [];
    for (const flag of flags.rows) {
      const key = String(flag.key);
      let affectedUsers = 0;
      let activeUsage = 0;
      switch (key) {
        case "growth":
          affectedUsers = (await this.query("SELECT COUNT(*)::int AS c FROM bodylog_seven_day_plans")).rows[0]
            ? Number((await this.query("SELECT COUNT(*)::int AS c FROM bodylog_seven_day_plans")).rows[0].c)
            : 0;
          activeUsage = (await this.query("SELECT COUNT(*)::int AS c FROM bodylog_seven_day_plans WHERE status = 'active'")).rows[0]
            ? Number((await this.query("SELECT COUNT(*)::int AS c FROM bodylog_seven_day_plans WHERE status = 'active'")).rows[0].c)
            : 0;
          break;
        case "friends":
          affectedUsers = (await this.query("SELECT COUNT(DISTINCT user_id)::int AS c FROM zook_bodylog_friendships")).rows[0]
            ? Number((await this.query("SELECT COUNT(DISTINCT user_id)::int AS c FROM zook_bodylog_friendships")).rows[0].c)
            : 0;
          activeUsage = affectedUsers;
          break;
        case "competition":
          affectedUsers = (await this.query("SELECT COUNT(DISTINCT user_id)::int AS c FROM zook_bodylog_leaderboard_entries")).rows[0]
            ? Number((await this.query("SELECT COUNT(DISTINCT user_id)::int AS c FROM zook_bodylog_leaderboard_entries")).rows[0].c)
            : 0;
          activeUsage = affectedUsers;
          break;
        case "challengeCreation":
          affectedUsers = (await this.query("SELECT COUNT(DISTINCT creator_user_id)::int AS c FROM zook_bodylog_challenges")).rows[0]
            ? Number((await this.query("SELECT COUNT(DISTINCT creator_user_id)::int AS c FROM zook_bodylog_challenges")).rows[0].c)
            : 0;
          activeUsage = (await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_challenges WHERE status = 'active'")).rows[0]
            ? Number((await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_challenges WHERE status = 'active'")).rows[0].c)
            : 0;
          break;
      }
      analytics.push({ key, affectedUsers, activeUsage });
    }
    return analytics;
  }

  // ===== Growth Plan Details =====

  async getGrowthPlanDetails(planId: string): Promise<AdminGrowthPlanDetails | null> {
    const planResult = await this.query(
      `SELECT p.*, u.nickname
       FROM bodylog_seven_day_plans p
       LEFT JOIN zook_bodylog_profiles u ON u.user_id = p.user_id
       WHERE p.id = $1`,
      [planId],
    );
    if (planResult.rows.length === 0) return null;
    const row = planResult.rows[0];

    const missionsResult = await this.query(
      `SELECT * FROM bodylog_missions WHERE plan_id = $1 ORDER BY day ASC`,
      [planId],
    );

    const rewardsResult = await this.query(
      `SELECT * FROM bodylog_rewards WHERE plan_id = $1 ORDER BY created_at ASC`,
      [planId],
    );

    const completedMissions = missionsResult.rows.filter((m) => m.completed).length;
    const totalMissions = missionsResult.rows.length;

    return {
      planId: String(row.id),
      userId: String(row.user_id),
      nickname: String(row.nickname ?? "Unknown"),
      status: String(row.status) as GrowthPlanStatus,
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      completedMissions,
      totalMissions,
      missions: missionsResult.rows.map((m) => ({
        missionId: String(m.id),
        day: Number(m.day),
        type: String(m.type),
        target: Number(m.target),
        completed: Boolean(m.completed),
        completedAt: m.completed_at ? String(m.completed_at) : null,
      })),
      rewards: rewardsResult.rows.map((r) => ({
        rewardId: String(r.id),
        type: String(r.type),
        value: String(r.value),
        claimed: Boolean(r.claimed),
        claimedAt: r.claimed_at ? String(r.claimed_at) : null,
      })),
    };
  }

  // ===== Manual Reward Issuance =====

  async manualIssueReward(input: { planId: string; userId: string; type: string; value: string }): Promise<AdminReward> {
    const planResult = await this.query(
      "SELECT id FROM bodylog_seven_day_plans WHERE id = $1 AND user_id = $2",
      [input.planId, input.userId],
    );
    if (!planResult.rows.length) throw new Error("Growth plan not found for user.");
    const result = await this.query(
      `INSERT INTO bodylog_rewards (plan_id, type, value, claimed, created_at)
       VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [input.planId, input.type, input.value],
    );
    const row = result.rows[0];
    return {
      rewardId: String(row.id),
      planId: String(row.plan_id),
      userId: input.userId,
      type: String(row.type),
      value: String(row.value),
      claimed: Boolean(row.claimed),
      claimedAt: row.claimed_at ? String(row.claimed_at) : null,
      createdAt: String(row.created_at),
    };
  }

  // ===== System Configuration =====

  async getNotificationConfig(): Promise<AdminNotificationConfig> {
    const result = await this.query("SELECT * FROM zook_config WHERE key = 'bodylog_notification_config' LIMIT 1");
    if (result.rows.length === 0) {
      return {
        pushDeliveryEnabled: true,
        defaultQuietHours: { isEnabled: false, startHour: 22, endHour: 8 },
      };
    }
    const config = typeof result.rows[0].value === "string" ? JSON.parse(result.rows[0].value) : result.rows[0].value;
    return config as AdminNotificationConfig;
  }

  async updateNotificationConfig(config: AdminNotificationConfig): Promise<void> {
    await this.query(
      `INSERT INTO zook_config (key, value, created_at, updated_at)
       VALUES ('bodylog_notification_config', $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(config)],
    );
  }

  async getScoringConfig(): Promise<AdminScoringConfig> {
    const result = await this.query("SELECT * FROM zook_config WHERE key = 'bodylog_scoring_config' LIMIT 1");
    if (result.rows.length === 0) {
      return {
        buddyCheckinBaseScore: 10,
        buddyEncouragementScore: 2,
        groupCheckinBaseScore: 15,
        challengeCompletionBonus: 50,
        growthMissionScore: 5,
      };
    }
    const config = typeof result.rows[0].value === "string" ? JSON.parse(result.rows[0].value) : result.rows[0].value;
    return config as AdminScoringConfig;
  }

  async updateScoringConfig(config: AdminScoringConfig): Promise<void> {
    await this.query(
      `INSERT INTO zook_config (key, value, created_at, updated_at)
       VALUES ('bodylog_scoring_config', $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(config)],
    );
  }

  async getSeasonConfig(): Promise<AdminSeasonConfig> {
    const result = await this.query("SELECT * FROM zook_config WHERE key = 'bodylog_season_config' LIMIT 1");
    if (result.rows.length === 0) {
      return {
        defaultDurationDays: 7,
        maxParticipantsPerSeason: 1000,
        allowAnonymousLeaderboard: false,
        autoCloseSeasons: true,
      };
    }
    const config = typeof result.rows[0].value === "string" ? JSON.parse(result.rows[0].value) : result.rows[0].value;
    return config as AdminSeasonConfig;
  }

  async updateSeasonConfig(config: AdminSeasonConfig): Promise<void> {
    await this.query(
      `INSERT INTO zook_config (key, value, created_at, updated_at)
       VALUES ('bodylog_season_config', $1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(config)],
    );
  }
}
