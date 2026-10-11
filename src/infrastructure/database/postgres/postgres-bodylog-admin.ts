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
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_groups WHERE app_id = $1", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM zook_bodylog_challenges WHERE app_id = $1", [appId]),
      this.query("SELECT COUNT(*)::int AS count FROM bodylog_seven_day_plans WHERE status = 'active'"),
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
      this.query("SELECT COUNT(*)::int AS count FROM bodylog_missions WHERE completed = true AND completed_at >= $1", [since]),
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
      ? "AND (p.nickname ILIKE $4 OR p.user_id = $4)"
      : "";
    const params: unknown[] = search ? [appId, limit, offset, `%${search}%`] : [appId, limit, offset];

    const [usersResult, countResult] = await Promise.all([
      this.query(
        `SELECT p.user_id, p.nickname, p.avatar_key, p.status, p.created_at, p.updated_at,
                COALESCE(s.tier, 'free') AS subscription_tier,
                (SELECT COUNT(*)::int FROM zook_bodylog_friendships f WHERE f.app_id = p.app_id AND f.user_id = p.user_id) AS friend_count,
                (SELECT COUNT(*)::int FROM zook_bodylog_buddy_pairs bp WHERE bp.app_id = p.app_id AND (bp.user_id = p.user_id OR bp.partner_user_id = p.user_id) AND bp.status = 'active') AS buddy_pair_count,
                (SELECT COUNT(*)::int FROM zook_bodylog_group_members gm
                 JOIN zook_bodylog_groups g ON g.id = gm.group_id AND g.app_id = p.app_id
                 WHERE gm.user_id = p.user_id) AS group_count
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
        `SELECT COUNT(*)::int AS count FROM zook_bodylog_profiles p WHERE p.app_id = $1 ${search ? "AND (p.nickname ILIKE $2 OR p.user_id = $2)" : ""}`,
        search ? [appId, `%${search}%`] : [appId],
      ),
    ]);

    const users: AdminUserProfile[] = usersResult.rows.map((row) => ({
      userId: String(row.user_id),
      nickname: String(row.nickname),
      avatarKey: (row.avatar_key as string | null) ?? null,
      status: String(row.status ?? "active") as AdminUserStatus,
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
        `SELECT r.id, r.reporter_user_id, r.reported_user_id, r.reason, r.status,
                r.resolved_at, r.resolved_by, r.resolution, r.created_at,
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
      status: String(row.status ?? "pending") as AdminReport["status"],
      createdAt: iso(row.created_at),
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
      resolvedBy: (row.resolved_by as string | null) ?? null,
      resolution: (row.resolution as string | null) ?? null,
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

  async listSeasons(appId: string, offset: number, limit: number): Promise<{ seasons: AdminSeason[]; total: number }> {
    const [entriesResult, countResult] = await Promise.all([
      this.query(
        `SELECT season_label, MIN(reached_at) AS start_date, MAX(reached_at) AS end_date,
                COUNT(*)::int AS participant_count
         FROM zook_bodylog_leaderboard_entries
         WHERE app_id = $1
         GROUP BY season_label
         ORDER BY season_label DESC
         LIMIT $2 OFFSET $3`,
        [appId, limit, offset],
      ),
      this.query("SELECT COUNT(DISTINCT season_label)::int AS count FROM zook_bodylog_leaderboard_entries WHERE app_id = $1", [appId]),
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
        `SELECT e.user_id, e.score, e.reached_at,
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
      joinedAt: iso(row.reached_at),
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
    let avgMembers = 0;
    if (total > 0) {
      const avgResult = await this.query(
        "SELECT AVG(cnt)::float AS avg FROM (SELECT COUNT(*)::int AS cnt FROM zook_bodylog_challenge_members cm JOIN zook_bodylog_challenges c ON c.id = cm.challenge_id WHERE c.app_id = $1 GROUP BY cm.challenge_id) sub",
        [appId],
      );
      avgMembers = Number(avgResult.rows[0]?.avg ?? 0);
    }
    return {
      totalChallenges: total,
      activeChallenges: Number(row?.active ?? 0),
      completedChallenges: Number(row?.completed ?? 0),
      avgMembersPerChallenge: avgMembers,
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

  // ===== User Details =====

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
