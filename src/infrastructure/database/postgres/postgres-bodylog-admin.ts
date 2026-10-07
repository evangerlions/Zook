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

export class PostgresBodyLogAdminStore {
  constructor(private readonly query: Query) {}

  // ===== Operations Dashboard =====

  async getOperationsSummary(appId: string): Promise<AdminOperationsSummary> {
    const [profiles, buddyPairs, groups, challenges, growthPlans, subscriptions] = await Promise.all([
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_profiles WHERE app_id = $1", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_buddy_pairs WHERE app_id = $1 AND status = 'active'", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_check_in_groups WHERE app_id = $1", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_challenges WHERE app_id = $1", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_growth_plans WHERE status = 'active'"),
      this.query(
        "SELECT tier, COUNT(*)::int AS count FROM zook_user_subscriptions WHERE app_id = $1 AND expires_at > NOW() GROUP BY tier",
        [appId],
      ),
    ]);

    const byTier: Record<string, number> = {};
    for (const row of subscriptions.rows) {
      byTier[String(row.tier)] = Number(row.count);
    }
    const totalActive = Object.values(byTier).reduce((sum, v) => sum + v, 0);

    return {
      overview: {
        totalUsers: Number(profiles.rows[0]?.count ?? 0),
        totalBuddyPairs: Number(buddyPairs.rows[0]?.count ?? 0),
        totalGroups: Number(groups.rows[0]?.count ?? 0),
        totalChallenges: Number(challenges.rows[0]?.count ?? 0),
        activeGrowthPlans: Number(growthPlans.rows[0]?.count ?? 0),
      },
      subscriptions: { totalActive, byTier },
      generatedAt: new Date().toISOString(),
    };
  }

  async getOperationsMetrics(appId: string, periodDays: number): Promise<AdminOperationsMetrics> {
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();
    const [newUsers, activeUsers, buddyCheckins, groupCheckins, challengesCompleted, growthMissions, newSubscriptions] = await Promise.all([
      this.query("SELECT COUNT(DISTINCT user_id)::int AS count FROM zook_bodylog_profiles WHERE app_id = $1 AND created_at >= $2", [appId, since]),
      this.query("SELECT COUNT(DISTINCT actor_user_id)::int AS count FROM zook_bodylog_buddy_activities WHERE created_at >= $1", [since]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_buddy_activities WHERE type = 'checked_in' AND created_at >= $1", [since]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_group_daily_records WHERE date >= $1", [since.slice(0, 10)]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_challenges WHERE status = 'settled' AND updated_at >= $1", [since]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_growth_missions WHERE completed = true AND completed_at >= $1", [since]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_user_subscriptions WHERE app_id = $1 AND created_at >= $2", [appId, since]),
    ]);

    return {
      period: periodDays === 7 ? "7d" : periodDays === 30 ? "30d" : "90d",
      newUsers: Number(newUsers.rows[0]?.count ?? 0),
      activeUsers: Number(activeUsers.rows[0]?.count ?? 0),
      buddyCheckins: Number(buddyCheckins.rows[0]?.count ?? 0),
      groupCheckins: Number(groupCheckins.rows[0]?.count ?? 0),
      challengesCompleted: Number(challengesCompleted.rows[0]?.count ?? 0),
      growthMissionsCompleted: Number(growthMissions.rows[0]?.count ?? 0),
      newSubscriptions: Number(newSubscriptions.rows[0]?.count ?? 0),
    };
  }

  // ===== User Management =====

  async listUserProfiles(
    appId: string,
    offset: number,
    limit: number,
    search?: string,
  ): Promise<{ users: AdminUserProfile[]; total: number }> {
    const searchClause = search
      ? "AND (p.nickname ILIKE $3 OR p.user_id = $3)"
      : "";
    const params: unknown[] = [appId, limit, offset];
    if (search) params.push(`%${search}%`);

    const [usersResult, countResult] = await Promise.all([
      this.query(
        `SELECT p.user_id, p.nickname, p.avatar_key, p.created_at, p.updated_at,
                COALESCE(s.tier, 'free') AS subscription_tier,
                (SELECT COUNT(*)::int FROM zook_bodylog_friendships f WHERE f.app_id = p.app_id AND f.user_id = p.user_id) AS friend_count,
                (SELECT COUNT(*)::int FROM zook_bodylog_buddy_pairs bp WHERE bp.app_id = p.app_id AND (bp.user_id = p.user_id OR bp.partner_user_id = p.user_id) AND bp.status = 'active') AS buddy_pair_count,
                (SELECT COUNT(*)::int FROM zook_bodylog_group_members gm WHERE gm.user_id = p.user_id) AS group_count
         FROM zook_bodylog_profiles p
         LEFT JOIN LATERAL (
           SELECT tier FROM zook_user_subscriptions
           WHERE app_id = p.app_id AND user_id = p.user_id AND expires_at > NOW()
           ORDER BY created_at DESC LIMIT 1
         ) s ON true
         WHERE p.app_id = $1 ${searchClause}
         ORDER BY p.created_at DESC
         LIMIT $2 OFFSET $3`,
        params,
      ),
      this.query(
        `SELECT COUNT(*)::int AS count FROM zook_bodylog_profiles p WHERE p.app_id = $1 ${searchClause}`,
        search ? [appId, search] : [appId],
      ),
    ]);

    const users: AdminUserProfile[] = usersResult.rows.map((row) => ({
      userId: String(row.user_id),
      nickname: String(row.nickname),
      avatarKey: (row.avatar_key as string | null) ?? null,
      status: "active" as const,
      createdAt: iso(row.created_at),
      lastActiveAt: row.updated_at ? iso(row.updated_at) : null,
      subscriptionTier: String(row.subscription_tier) as AdminUserProfile["subscriptionTier"],
      friendCount: Number(row.friend_count),
      buddyPairCount: Number(row.buddy_pair_count),
      groupCount: Number(row.group_count),
    }));

    return { users, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async countProfiles(appId: string): Promise<number> {
    const result = await this.query(
      "SELECT COUNT(*)::int AS count FROM zook_bodylog_profiles WHERE app_id = $1",
      [appId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  // ===== Social Moderation =====

  async listReportsPaginated(
    appId: string,
    offset: number,
    limit: number,
  ): Promise<{ reports: AdminReport[]; total: number }> {
    const [reportsResult, countResult] = await Promise.all([
      this.query(
        `SELECT r.id, r.reporter_user_id, r.reported_user_id, r.reason, r.created_at,
                rp.nickname AS reporter_nickname,
                rp2.nickname AS reported_nickname
         FROM zook_bodylog_reports r
         LEFT JOIN zook_bodylog_profiles rp ON rp.app_id = r.app_id AND rp.user_id = r.reporter_user_id
         LEFT JOIN zook_bodylog_profiles rp2 ON rp2.app_id = r.app_id AND rp2.user_id = r.reported_user_id
         WHERE r.app_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2 OFFSET $3`,
        [appId, limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_reports WHERE app_id = $1", [appId]),
    ]);

    const reports: AdminReport[] = reportsResult.rows.map((row) => ({
      reportId: String(row.id),
      reporterUserId: String(row.reporter_user_id),
      reporterNickname: String(row.reporter_nickname ?? "unknown"),
      reportedUserId: String(row.reported_user_id),
      reportedNickname: String(row.reported_nickname ?? "unknown"),
      reason: String(row.reason) as AdminReport["reason"],
      status: "pending" as const,
      createdAt: iso(row.created_at),
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    }));

    return { reports, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async listBlocksPaginated(
    appId: string,
    offset: number,
    limit: number,
  ): Promise<{ blocks: AdminBlock[]; total: number }> {
    const [blocksResult, countResult] = await Promise.all([
      this.query(
        `SELECT b.blocker_user_id, b.blocked_user_id, b.created_at,
                rp1.nickname AS blocker_nickname,
                rp2.nickname AS blocked_nickname
         FROM zook_bodylog_blocks b
         LEFT JOIN zook_bodylog_profiles rp1 ON rp1.app_id = b.app_id AND rp1.user_id = b.blocker_user_id
         LEFT JOIN zook_bodylog_profiles rp2 ON rp2.app_id = b.app_id AND rp2.user_id = b.blocked_user_id
         WHERE b.app_id = $1
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [appId, limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_blocks WHERE app_id = $1", [appId]),
    ]);

    const blocks: AdminBlock[] = blocksResult.rows.map((row) => ({
      blockerUserId: String(row.blocker_user_id),
      blockerNickname: String(row.blocker_nickname ?? "unknown"),
      blockedUserId: String(row.blocked_user_id),
      blockedNickname: String(row.blocked_nickname ?? "unknown"),
      createdAt: iso(row.created_at),
    }));

    return { blocks, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async deleteBlock(appId: string, blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.query(
      "DELETE FROM zook_bodylog_blocks WHERE app_id = $1 AND blocker_user_id = $2 AND blocked_user_id = $3",
      [appId, blockerUserId, blockedUserId],
    );
  }

  // ===== Leaderboard Management =====

  async listSeasons(offset: number, limit: number): Promise<{ seasons: AdminSeason[]; total: number }> {
    const [entriesResult, countResult] = await Promise.all([
      this.query(
        `SELECT season_label, MIN(joined_at) AS start_date, MAX(joined_at) AS end_date,
                COUNT(*)::int AS participant_count
         FROM zook_bodylog_leaderboard_entries
         GROUP BY season_label
         ORDER BY season_label DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query("SELECT COUNT(DISTINCT season_label)::int AS count FROM zook_bodylog_leaderboard_entries"),
    ]);

    const currentSeason = this.currentSeasonLabel();
    const seasons: AdminSeason[] = entriesResult.rows.map((row) => {
      const label = String(row.season_label);
      return {
        seasonLabel: label,
        startDate: iso(row.start_date),
        endDate: iso(row.end_date),
        participantCount: Number(row.participant_count),
        status: label === currentSeason ? "active" as const : "completed" as const,
      };
    });

    return { seasons, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async listSeasonRankings(
    appId: string,
    seasonLabel: string,
    offset: number,
    limit: number,
  ): Promise<{ rankings: AdminSeasonRanking[]; total: number }> {
    const [rankingsResult, countResult] = await Promise.all([
      this.query(
        `SELECT e.user_id, e.score, e.joined_at,
                p.nickname, p.avatar_key,
                RANK() OVER (ORDER BY e.score DESC) AS rank
         FROM zook_bodylog_leaderboard_entries e
         LEFT JOIN zook_bodylog_profiles p ON p.app_id = e.app_id AND p.user_id = e.user_id
         WHERE e.app_id = $1 AND e.season_label = $2
         ORDER BY e.score DESC
         LIMIT $3 OFFSET $4`,
        [appId, seasonLabel, limit, offset],
      ),
      this.query(
        "SELECT COUNT(*)::int AS count FROM zook_bodylog_leaderboard_entries WHERE app_id = $1 AND season_label = $2",
        [appId, seasonLabel],
      ),
    ]);

    const rankings: AdminSeasonRanking[] = rankingsResult.rows.map((row) => ({
      rank: Number(row.rank),
      userId: String(row.user_id),
      nickname: String(row.nickname ?? "unknown"),
      avatarKey: (row.avatar_key as string | null) ?? null,
      score: Number(row.score),
      completedDays: 0,
      joinedAt: iso(row.joined_at),
    }));

    return { rankings, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async removeSeasonEntry(appId: string, seasonLabel: string, userId: string): Promise<void> {
    await this.query(
      "DELETE FROM zook_bodylog_leaderboard_entries WHERE app_id = $1 AND season_label = $2 AND user_id = $3",
      [appId, seasonLabel, userId],
    );
  }

  // ===== Challenge Management =====

  async listChallengesPaginated(
    appId: string,
    offset: number,
    limit: number,
  ): Promise<{ challenges: AdminChallenge[]; total: number }> {
    const [challengesResult, countResult] = await Promise.all([
      this.query(
        `SELECT c.id, c.creator_user_id, c.theme_key, c.status, c.created_at,
                p.nickname AS creator_nickname,
                (SELECT COUNT(*)::int FROM zook_bodylog_challenge_members cm WHERE cm.challenge_id = c.id) AS member_count
         FROM zook_bodylog_challenges c
         LEFT JOIN zook_bodylog_profiles p ON p.app_id = c.app_id AND p.user_id = c.creator_user_id
         WHERE c.app_id = $1
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [appId, limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_challenges WHERE app_id = $1", [appId]),
    ]);

    const challenges: AdminChallenge[] = challengesResult.rows.map((row) => ({
      challengeId: String(row.id),
      creatorUserId: String(row.creator_user_id),
      creatorNickname: String(row.creator_nickname ?? "unknown"),
      themeKey: String(row.theme_key),
      status: String(row.status),
      memberCount: Number(row.member_count),
      createdAt: iso(row.created_at),
    }));

    return { challenges, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  async getChallengeStatistics(appId: string): Promise<AdminChallengeStatistics> {
    const result = await this.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'settled')::int AS completed
       FROM zook_bodylog_challenges WHERE app_id = $1`,
      [appId],
    );
    const row = result.rows[0];
    const total = Number(row?.total ?? 0);
    return {
      totalChallenges: total,
      activeChallenges: Number(row?.active ?? 0),
      completedChallenges: Number(row?.completed ?? 0),
      avgMembersPerChallenge: total > 0
        ? (await this.query(
            "SELECT AVG(cnt)::float AS avg FROM (SELECT COUNT(*)::int AS cnt FROM zook_bodylog_challenge_members cm JOIN zook_bodylog_challenges c ON c.id = cm.challenge_id WHERE c.app_id = $1 GROUP BY cm.challenge_id) sub",
            [appId],
          )).rows[0] ? Number((await this.query(
            "SELECT AVG(cnt)::float AS avg FROM (SELECT COUNT(*)::int AS cnt FROM zook_bodylog_challenge_members cm JOIN zook_bodylog_challenges c ON c.id = cm.challenge_id WHERE c.app_id = $1 GROUP BY cm.challenge_id) sub",
            [appId],
          )).rows[0]?.avg ?? 0)
        : 0,
    };
  }

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
         FROM zook_bodylog_growth_plans gp
         LEFT JOIN zook_bodylog_profiles p ON p.app_id = 'bodylog' AND p.user_id = gp.user_id
         ORDER BY gp.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_growth_plans"),
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
       FROM zook_bodylog_growth_plans`,
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
         FROM zook_bodylog_rewards
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_rewards"),
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
       FROM zook_bodylog_rewards`,
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
          affectedUsers = (await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_growth_plans")).rows[0]
            ? Number((await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_growth_plans")).rows[0].c)
            : 0;
          activeUsage = (await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_growth_plans WHERE status = 'active'")).rows[0]
            ? Number((await this.query("SELECT COUNT(*)::int AS c FROM zook_bodylog_growth_plans WHERE status = 'active'")).rows[0].c)
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

  // ===== Helpers =====

  private currentSeasonLabel(): string {
    const now = new Date();
    const day = now.getUTCDay() || 7;
    const date = new Date(now.getTime());
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
}
