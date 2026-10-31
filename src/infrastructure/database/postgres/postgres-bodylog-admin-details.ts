import type {
  AdminBlock,
  AdminChallenge,
  AdminChallengeStatistics,
  AdminFeatureFlag,
  AdminFeatureFlagAnalytics,
  AdminGrowthPlan,
  AdminGrowthStatistics,
  AdminOperationsMetrics,
  AdminOperationsSummary,
  AdminReport,
  AdminReward,
  AdminRewardStatistics,
  AdminSeason,
  AdminSeasonRanking,
  AdminUserDetails,
  AdminUserProfile,
  AdminUserStatus,
} from "../../../modules/bodylog/bodylog-admin.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export class PostgresBodyLogAdminDetailsStore {
  constructor(private readonly query: Query) {}

  async getUserDetails(appId: string, userId: string): Promise<AdminUserDetails | null> {
    const profileResult = await this.query(
      `SELECT p.*, u.email,
              COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_friendships WHERE app_id = $1 AND user_id = $2), 0) AS friend_count,
              COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_buddy_pairs WHERE app_id = $1 AND (user_id = $2 OR partner_user_id = $2)), 0) AS buddy_pair_count,
              COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_group_members gm
                        JOIN zook_bodylog_groups g ON g.id = gm.group_id AND g.app_id = $1
                        WHERE gm.user_id = $2), 0) AS group_count,
              COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_friend_requests WHERE app_id = $1 AND sender_user_id = $2 AND status = 'pending'), 0) AS pending_requests
       FROM zook_bodylog_profiles p
       LEFT JOIN zook_users u ON u.id = $2
       WHERE p.app_id = $1 AND p.user_id = $2`,
      [appId, userId],
    );
    if (profileResult.rows.length === 0) return null;
    const row = profileResult.rows[0];

    const subscriptionResult = await this.query(
      `SELECT * FROM zook_user_subscriptions WHERE app_id = $1 AND user_id = $2 ORDER BY expires_at DESC LIMIT 1`,
      [appId, userId],
    );
    const subRow = subscriptionResult.rows[0];

    const growthPlanResult = await this.query(
      `SELECT p.*,
              COALESCE((SELECT COUNT(*)::int FROM bodylog_missions WHERE plan_id = p.id AND completed = true), 0) AS completed_missions,
              COALESCE((SELECT COUNT(*)::int FROM bodylog_missions WHERE plan_id = p.id), 0) AS total_missions
       FROM bodylog_seven_day_plans p
       WHERE p.user_id = $1 AND p.status = 'active'
       ORDER BY p.start_date DESC LIMIT 1`,
      [userId],
    );
    const planRow = growthPlanResult.rows[0];

    const reportsResult = await this.query(
      `SELECT
         COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_reports WHERE app_id = $1 AND reporter_user_id = $2), 0) AS reports_made,
         COALESCE((SELECT COUNT(*)::int FROM zook_bodylog_reports WHERE app_id = $1 AND reported_user_id = $2), 0) AS reports_received`,
      [appId, userId],
    );
    const reportsRow = reportsResult.rows[0];

    return {
      userId: String(row.user_id),
      nickname: String(row.nickname),
      avatarKey: row.avatar_key ?? null,
      status: (row.status ?? "active") as AdminUserStatus,
      createdAt: String(row.created_at),
      lastActiveAt: row.last_active_at ? String(row.last_active_at) : null,
      subscriptionTier: (row.subscription_tier ?? "free") as SubscriptionTier,
      friendCount: Number(row.friend_count ?? 0),
      buddyPairCount: Number(row.buddy_pair_count ?? 0),
      groupCount: Number(row.group_count ?? 0),
      email: row.email ? String(row.email) : null,
      subscription: subRow ? {
        tier: String(subRow.tier) as SubscriptionTier,
        expiresAt: subRow.expires_at ? String(subRow.expires_at) : null,
        startedAt: String(subRow.started_at),
      } : null,
      social: {
        friendsCount: Number(row.friend_count ?? 0),
        buddyPairsCount: Number(row.buddy_pair_count ?? 0),
        groupsCount: Number(row.group_count ?? 0),
        friendRequestsPending: Number(row.pending_requests ?? 0),
      },
      growth: {
        activePlan: planRow ? {
          planId: String(planRow.id),
          startDate: String(planRow.start_date),
          completedMissions: Number(planRow.completed_missions ?? 0),
          totalMissions: Number(planRow.total_missions ?? 0),
        } : null,
      },
      reports: {
        reportsMade: Number(reportsRow?.reports_made ?? 0),
        reportsReceived: Number(reportsRow?.reports_received ?? 0),
      },
    };
  }

  async updateUserStatus(appId: string, userId: string, status: AdminUserStatus): Promise<void> {
    await this.query(
      `UPDATE zook_bodylog_profiles SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE app_id = $1 AND user_id = $2`,
      [appId, userId, status],
    );
  }

  async resetUserData(appId: string, userId: string): Promise<void> {
    await this.query(`DELETE FROM zook_bodylog_profiles WHERE app_id = $1 AND user_id = $2`, [appId, userId]);
    await this.query(`DELETE FROM zook_bodylog_buddy_pairs WHERE app_id = $1 AND (user_id = $2 OR partner_user_id = $2)`, [appId, userId]);
    await this.query(`DELETE FROM zook_bodylog_group_members WHERE user_id = $2`, [userId]);
    await this.query(`DELETE FROM bodylog_seven_day_plans WHERE user_id = $2`, [userId]);
    await this.query(`DELETE FROM zook_bodylog_leaderboard_entries WHERE app_id = $1 AND user_id = $2`, [appId, userId]);
    await this.query(`DELETE FROM zook_user_subscriptions WHERE app_id = $1 AND user_id = $2`, [appId, userId]);
  }

  // ===== Report Resolution =====

  async resolveReport(reportId: string, resolvedBy: string, resolution: string): Promise<void> {
    await this.query(
      `UPDATE zook_bodylog_reports SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolution = $3 WHERE id = $1`,
      [reportId, resolvedBy, resolution],
    );
  }

  // ===== Challenge Details =====

  async getChallengeDetails(appId: string, challengeId: string): Promise<AdminChallengeDetails | null> {
    const challengeResult = await this.query(
      `SELECT c.*, u.nickname AS creator_nickname,
              (SELECT COUNT(*)::int FROM zook_bodylog_challenge_members cm WHERE cm.challenge_id = c.id) AS member_count
       FROM zook_bodylog_challenges c
       LEFT JOIN zook_bodylog_profiles u ON u.user_id = c.creator_user_id AND u.app_id = c.app_id
       WHERE c.id = $1 AND c.app_id = $2`,
      [challengeId, appId],
    );
    if (challengeResult.rows.length === 0) return null;
    const row = challengeResult.rows[0];

    const membersResult = await this.query(
      `SELECT m.*, p.nickname,
              COALESCE(m.completed_dates::text, '[]') AS completed_dates
       FROM zook_bodylog_challenge_members m
       LEFT JOIN zook_bodylog_profiles p ON p.user_id = m.user_id AND p.app_id = $1
       WHERE m.challenge_id = $2
       ORDER BY m.joined_at ASC`,
      [appId, challengeId],
    );

    return {
      challengeId: String(row.id),
      creatorUserId: String(row.creator_user_id),
      creatorNickname: String(row.creator_nickname ?? "Unknown"),
      themeKey: String(row.theme_key),
      status: String(row.status),
      memberCount: Number(row.member_count ?? 0),
      createdAt: String(row.created_at),
      members: membersResult.rows.map((m) => ({
        userId: String(m.user_id),
        nickname: String(m.nickname ?? "Unknown"),
        status: String(m.status),
        completedDates: JSON.parse(m.completed_dates ?? "[]"),
        joinedAt: String(m.joined_at),
      })),
    };
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

  // ===== Helpers =====

}
