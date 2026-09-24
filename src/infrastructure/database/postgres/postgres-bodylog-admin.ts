/**
 * BodyLog 后台管理数据存储
 *
 * 提供管理后台所需的打卡数据查询、群组监控、习惯模板管理等功能。
 */

import type {
  BodyLogCheckinDashboardAggregate,
  BodyLogCheckinRecordRow,
  BodyLogGroupHealthRow,
  BodyLogGroupMemberContributionRow,
  BodyLogHabitTemplateRecord,
  BodyLogHabitUsageRow,
} from "../../../modules/bodylog/bodylog-admin.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;

export class PostgresBodyLogAdminStore {
  constructor(private readonly query: Query) {}

  /**
   * 获取打卡 Dashboard 聚合数据
   */
  async getBodyLogCheckinDashboard(input: {
    appId: string;
    fromDate: string;
    toDate: string;
    timezone: string;
  }): Promise<BodyLogCheckinDashboardAggregate> {
    // 1. 获取汇总统计
    const summaryResult = await this.query(
      `SELECT
        COUNT(DISTINCT g.id) as total_groups,
        COALESCE(SUM(gm_count.member_count), 0) as total_members,
        COUNT(DISTINCT CASE WHEN g.last_active_date >= CURRENT_DATE - INTERVAL '7 days' THEN g.id END) as active_groups
      FROM zook_bodylog_groups g
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as member_count
        FROM zook_bodylog_group_members gm
        WHERE gm.group_id = g.id AND gm.status = 'active'
      ) gm_count ON true
      WHERE g.app_id = $1`,
      [input.appId]
    );

    const summary = summaryResult.rows[0] as Record<string, number>;

    // The rates are weighted by each group-day's member count so a small
    // group does not contribute as much as a large group in the dashboard.
    const checkinRatesResult = await this.query(
      `SELECT
        COALESCE(ROUND(100.0 * SUM(CASE WHEN r.date = $2::date THEN r.completed_count ELSE 0 END)
          / NULLIF(SUM(CASE WHEN r.date = $2::date THEN r.total_members ELSE 0 END), 0), 2), 0) as daily,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN r.date > $2::date - INTERVAL '7 days' THEN r.completed_count ELSE 0 END)
          / NULLIF(SUM(CASE WHEN r.date > $2::date - INTERVAL '7 days' THEN r.total_members ELSE 0 END), 0), 2), 0) as weekly,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN r.date > $2::date - INTERVAL '30 days' THEN r.completed_count ELSE 0 END)
          / NULLIF(SUM(CASE WHEN r.date > $2::date - INTERVAL '30 days' THEN r.total_members ELSE 0 END), 0), 2), 0) as monthly
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      WHERE g.app_id = $1 AND r.date <= $2::date
        AND r.date >= LEAST($3::date, $2::date - INTERVAL '29 days')`,
      [input.appId, input.toDate, input.fromDate]
    );
    const checkinRates = checkinRatesResult.rows[0] as Record<string, number> | undefined;

    // 2. 计算 DAU 和今日打卡数（从 JSONB 数组展开）
    const dailyStatsResult = await this.query(
      `SELECT
        COUNT(DISTINCT uid) as dau,
        COUNT(*) as total_checkins
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      CROSS JOIN LATERAL jsonb_array_elements_text(r.completed_user_ids) AS uid
      WHERE g.app_id = $1
        AND r.date >= $2::date
        AND r.date <= $3::date`,
      [input.appId, input.fromDate, input.toDate]
    );

    const dailyStats = dailyStatsResult.rows[0] as Record<string, number>;

    // 3. 获取趋势数据
    const trendResult = await this.query(
      `SELECT
        r.date::text as date,
        COUNT(DISTINCT uid) as dau,
        SUM(r.completed_count) as checkins,
        ROUND(AVG(r.completion_rate)::numeric, 2) as completion_rate
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      CROSS JOIN LATERAL jsonb_array_elements_text(r.completed_user_ids) AS uid
      WHERE g.app_id = $1
        AND r.date >= $2::date
        AND r.date <= $3::date
      GROUP BY r.date
      ORDER BY r.date ASC`,
      [input.appId, input.fromDate, input.toDate]
    );

    // 4. 计算连续打卡分布（简化版：基于群组连续天数）
    const consecutiveResult = await this.query(
      `SELECT
        CASE
          WHEN consecutive_days = 0 THEN '0'
          WHEN consecutive_days BETWEEN 1 AND 2 THEN '1-2'
          WHEN consecutive_days BETWEEN 3 AND 6 THEN '3-6'
          WHEN consecutive_days BETWEEN 7 AND 13 THEN '7-13'
          WHEN consecutive_days BETWEEN 14 AND 29 THEN '14-29'
          ELSE '30+'
        END as bucket,
        COUNT(*) as group_count
      FROM zook_bodylog_groups
      WHERE app_id = $1 AND status = 'active'
      GROUP BY bucket
      ORDER BY MIN(consecutive_days)`,
      [input.appId]
    );

    // 5. 获取习惯分布
    const habitResult = await this.query(
      `SELECT
        target_habit_id as habit_id,
        COUNT(*) as checkins
      FROM zook_bodylog_group_activities
      JOIN zook_bodylog_groups g ON group_id = g.id
      WHERE g.app_id = $1
        AND type = 'checked_in'
        AND created_at >= $2::timestamptz
        AND created_at < ($3::date + INTERVAL '1 day')::timestamptz
        AND target_habit_id IS NOT NULL
      GROUP BY target_habit_id
      ORDER BY checkins DESC
      LIMIT 10`,
      [input.appId, input.fromDate, input.toDate]
    );

    const totalCheckins = habitResult.rows.reduce((sum, row) => sum + Number(row.checkins), 0);

    return {
      summary: {
        dau: Number(dailyStats.dau) || 0,
        checkins_today: Number(dailyStats.total_checkins) || 0,
        active_groups: Number(summary.active_groups) || 0,
        total_groups: Number(summary.total_groups) || 0,
        total_members: Number(summary.total_members) || 0,
        checkin_rate_daily: Number(checkinRates?.daily) || 0,
        checkin_rate_weekly: Number(checkinRates?.weekly) || 0,
        checkin_rate_monthly: Number(checkinRates?.monthly) || 0,
      },
      trend: trendResult.rows.map((row) => ({
        date: row.date as string,
        dau: Number(row.dau),
        checkins: Number(row.checkins),
        completion_rate: Number(row.completion_rate),
      })),
      consecutive_distribution: consecutiveResult.rows.map((row) => ({
        bucket: row.bucket as string,
        users: Number(row.group_count),
      })),
      habit_distribution: habitResult.rows.map((row) => ({
        habit_id: row.habit_id as string,
        checkins: Number(row.checkins),
        share: totalCheckins > 0 ? Number(row.checkins) / totalCheckins : 0,
      })),
    };
  }

  /**
   * 列出用户在指定日期范围内的打卡日期
   */
  async listBodyLogCheckinUserDates(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): Promise<Array<{ userId: string; date: string }>> {
    const result = await this.query(
      `SELECT DISTINCT uid as user_id, r.date::text as date
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      CROSS JOIN LATERAL jsonb_array_elements_text(r.completed_user_ids) AS uid
      WHERE g.app_id = $1
        AND r.date >= $2::date
        AND r.date <= $3::date
      ORDER BY uid, r.date`,
      [input.appId, input.fromDate, input.toDate]
    );

    return result.rows.map((row) => ({
      userId: row.user_id as string,
      date: row.date as string,
    }));
  }

  /**
   * 搜索打卡记录
   */
  async searchBodyLogCheckinRecords(input: {
    appId: string;
    userId?: string;
    groupId?: string;
    fromDate?: string;
    toDate?: string;
    page: number;
    limit: number;
  }): Promise<{ items: BodyLogCheckinRecordRow[]; total: number }> {
    const conditions: string[] = ["g.app_id = $1"];
    const params: unknown[] = [input.appId];
    let paramIndex = 2;

    if (input.groupId) {
      conditions.push(`r.group_id = $${paramIndex}`);
      params.push(input.groupId);
      paramIndex++;
    }

    if (input.fromDate) {
      conditions.push(`r.date >= $${paramIndex}::date`);
      params.push(input.fromDate);
      paramIndex++;
    }

    if (input.toDate) {
      conditions.push(`r.date <= $${paramIndex}::date`);
      params.push(input.toDate);
      paramIndex++;
    }

    // 如果指定了 userId，需要展开 JSONB 数组
    let joinClause = "";
    if (input.userId) {
      joinClause = "CROSS JOIN LATERAL jsonb_array_elements_text(r.completed_user_ids) AS uid";
      conditions.push(`uid = $${paramIndex}`);
      params.push(input.userId);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // 获取总数
    const countResult = await this.query(
      `SELECT COUNT(DISTINCT r.id) as total
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      ${joinClause}
      WHERE ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0]?.total) || 0;

    // 获取分页数据
    const offset = (input.page - 1) * input.limit;
    params.push(input.limit, offset);

    const result = await this.query(
      `SELECT
        r.id as record_id,
        r.date::text as date,
        r.group_id,
        g.name as group_name,
        r.completed_user_ids,
        r.completed_count,
        r.total_members,
        r.completion_rate,
        r.created_at::text as created_at
      FROM zook_bodylog_group_daily_records r
      JOIN zook_bodylog_groups g ON r.group_id = g.id
      ${joinClause}
      WHERE ${whereClause}
      GROUP BY r.id, r.date, r.group_id, g.name, r.completed_user_ids, r.completed_count, r.total_members, r.completion_rate, r.created_at
      ORDER BY r.date DESC, r.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    // 展开每条记录的用户列表
    const items: BodyLogCheckinRecordRow[] = [];
    for (const row of result.rows) {
      const rawUserIds = row.completed_user_ids;
      const userIds = Array.isArray(rawUserIds)
        ? rawUserIds.map(value => String(value))
        : typeof rawUserIds === "string"
          ? JSON.parse(rawUserIds) as string[]
          : [];
      for (const userId of userIds) {
        // 如果指定了 userId，只返回该用户的记录
        if (input.userId && userId !== input.userId) continue;

        items.push({
          recordId: row.record_id as string,
          date: row.date as string,
          groupId: row.group_id as string,
          groupName: row.group_name as string,
          userId,
          completedCount: Number(row.completed_count),
          totalMembers: Number(row.total_members),
          completionRate: Number(row.completion_rate),
          createdAt: row.created_at as string,
        });
      }
    }

    return { items, total };
  }

  /**
   * 列出群组健康度
   */
  async listBodyLogGroupHealth(input: {
    appId: string;
    status?: string;
    health?: "active" | "stale" | "dead";
    fromDate: string;
    toDate: string;
    page: number;
    limit: number;
  }): Promise<{ items: BodyLogGroupHealthRow[]; total: number }> {
    const conditions: string[] = ["g.app_id = $1"];
    const params: unknown[] = [input.appId];
    let paramIndex = 2;

    if (input.status) {
      conditions.push(`g.status = $${paramIndex}`);
      params.push(input.status);
      paramIndex++;
    }

    if (input.health) {
      const now = new Date();
      const daysAgo = (days: number) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        return d.toISOString().split("T")[0];
      };

      switch (input.health) {
        case "active":
          conditions.push(`g.last_active_date >= $${paramIndex}::date`);
          params.push(daysAgo(7));
          paramIndex++;
          break;
        case "stale":
          conditions.push(`g.last_active_date < $${paramIndex}::date`);
          params.push(daysAgo(7));
          paramIndex++;
          conditions.push(`g.last_active_date >= $${paramIndex}::date`);
          params.push(daysAgo(30));
          paramIndex++;
          break;
        case "dead":
          conditions.push(`g.last_active_date < $${paramIndex}::date`);
          params.push(daysAgo(30));
          paramIndex++;
          break;
      }
    }

    const whereClause = conditions.join(" AND ");

    // 获取总数
    const countResult = await this.query(
      `SELECT COUNT(*) as total FROM zook_bodylog_groups g WHERE ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0]?.total) || 0;

    // 获取分页数据
    const offset = (input.page - 1) * input.limit;
    params.push(input.limit, offset);

    const result = await this.query(
      `SELECT
        g.id as group_id,
        g.name,
        g.status,
        g.leader_user_id,
        g.created_at::text as created_at,
        g.last_active_date::text as last_active_date,
        COALESCE(member_stats.member_count, 0) as member_count,
        COALESCE(checkin_stats.checkins_7d, 0) as checkins_7d,
        COALESCE(checkin_stats.checkins_30d, 0) as checkins_30d,
        COALESCE(checkin_stats.active_members_7d, 0) as active_members_7d,
        COALESCE(checkin_stats.completion_rate_7d, 0) as completion_rate_7d
      FROM zook_bodylog_groups g
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as member_count
        FROM zook_bodylog_group_members gm
        WHERE gm.group_id = g.id AND gm.status = 'active'
      ) member_stats ON true
      LEFT JOIN LATERAL (
        SELECT
          SUM(CASE WHEN r.date >= CURRENT_DATE - INTERVAL '7 days' THEN r.completed_count ELSE 0 END) as checkins_7d,
          SUM(CASE WHEN r.date >= CURRENT_DATE - INTERVAL '30 days' THEN r.completed_count ELSE 0 END) as checkins_30d,
          COUNT(DISTINCT CASE WHEN r.date >= CURRENT_DATE - INTERVAL '7 days' THEN uid END) as active_members_7d,
          ROUND(AVG(CASE WHEN r.date >= CURRENT_DATE - INTERVAL '7 days' THEN r.completion_rate END)::numeric, 2) as completion_rate_7d
        FROM zook_bodylog_group_daily_records r
        CROSS JOIN LATERAL jsonb_array_elements_text(r.completed_user_ids) AS uid
        WHERE r.group_id = g.id
      ) checkin_stats ON true
      WHERE ${whereClause}
      ORDER BY g.last_active_date DESC NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return {
      items: result.rows.map((row) => ({
        groupId: row.group_id as string,
        name: row.name as string,
        status: row.status as string,
        memberCount: Number(row.member_count),
        leaderUserId: row.leader_user_id as string,
        createdAt: row.created_at as string,
        lastActiveDate: (row.last_active_date || "") as string,
        checkins7d: Number(row.checkins_7d),
        checkins30d: Number(row.checkins_30d),
        activeMembers7d: Number(row.active_members_7d),
        completionRate7d: Number(row.completion_rate_7d) || 0,
      })),
      total,
    };
  }

  /**
   * 列出群组成员贡献
   */
  async listBodyLogGroupMemberContributions(input: {
    groupId: string;
    fromDate: string;
    toDate: string;
  }): Promise<BodyLogGroupMemberContributionRow[]> {
    const result = await this.query(
      `SELECT
        gm.user_id,
        gm.role,
        gm.status,
        p.nickname,
        p.avatar_key,
        COUNT(CASE WHEN a.type = 'checked_in' THEN 1 END) as checkin_count,
        MAX(CASE WHEN a.type = 'checked_in' THEN a.created_at END)::text as last_checkin_at
      FROM zook_bodylog_group_members gm
      JOIN zook_bodylog_groups g ON g.id = gm.group_id
      LEFT JOIN zook_bodylog_profiles p ON p.app_id = g.app_id AND p.user_id = gm.user_id
      LEFT JOIN zook_bodylog_group_activities a ON gm.group_id = a.group_id
        AND gm.user_id = a.actor_user_id
        AND a.type = 'checked_in'
        AND a.created_at >= $2::timestamptz
        AND a.created_at < ($3::date + INTERVAL '1 day')::timestamptz
      WHERE gm.group_id = $1 AND gm.status = 'active'
      GROUP BY gm.user_id, gm.role, gm.status, p.nickname, p.avatar_key
      ORDER BY checkin_count DESC`,
      [input.groupId, input.fromDate, input.toDate]
    );

    return result.rows.map((row) => ({
      userId: row.user_id as string,
      nickname: (row.nickname || "") as string,
      avatarKey: (row.avatar_key || null) as string | null,
      role: row.role as string,
      status: row.status as string,
      checkinCount: Number(row.checkin_count),
      lastCheckinAt: (row.last_checkin_at || "") as string,
    }));
  }

  /**
   * 列出习惯使用情况
   */
  async listBodyLogHabitUsage(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): Promise<BodyLogHabitUsageRow[]> {
    const result = await this.query(
      `SELECT
        target_habit_id as habit_id,
        COUNT(*) as checkins,
        MAX(created_at)::text as last_checkin_at
      FROM zook_bodylog_group_activities
      JOIN zook_bodylog_groups g ON group_id = g.id
      WHERE g.app_id = $1
        AND type = 'checked_in'
        AND created_at >= $2::timestamptz
        AND created_at < ($3::date + INTERVAL '1 day')::timestamptz
        AND target_habit_id IS NOT NULL
      GROUP BY target_habit_id
      ORDER BY checkins DESC`,
      [input.appId, input.fromDate, input.toDate]
    );

    return result.rows.map((row) => ({
      habitId: row.habit_id as string,
      checkins: Number(row.checkins),
      lastCheckinAt: row.last_checkin_at as string,
    }));
  }

  /**
   * 列出习惯模板
   */
  async listBodyLogHabitTemplates(appId: string): Promise<BodyLogHabitTemplateRecord[]> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates
      WHERE app_id = $1
      ORDER BY sort_order ASC, created_at ASC`,
      [appId]
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  /**
   * 查找习惯模板
   */
  async findBodyLogHabitTemplate(appId: string, id: string): Promise<BodyLogHabitTemplateRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates WHERE app_id = $1 AND id = $2`,
      [appId, id]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * 通过 key 查找习惯模板
   */
  async findBodyLogHabitTemplateByKey(appId: string, key: string): Promise<BodyLogHabitTemplateRecord | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_bodylog_habit_templates WHERE app_id = $1 AND template_key = $2`,
      [appId, key]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];
    return {
      id: row.id as string,
      appId: row.app_id as string,
      templateKey: row.template_key as string,
      category: row.category as string,
      names: (row.names || {}) as Record<string, string>,
      icon: (row.icon as string) || null,
      defaultTargetCount: Number(row.default_target_count),
      sortOrder: Number(row.sort_order),
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * 插入习惯模板
   */
  async insertBodyLogHabitTemplate(record: BodyLogHabitTemplateRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_bodylog_habit_templates (
        id, app_id, template_key, category, names, icon,
        default_target_count, sort_order, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
      [
        record.id,
        record.appId,
        record.templateKey,
        record.category,
        JSON.stringify(record.names),
        record.icon,
        record.defaultTargetCount,
        record.sortOrder,
        record.status,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  /**
   * 更新习惯模板
   */
  async updateBodyLogHabitTemplate(record: BodyLogHabitTemplateRecord): Promise<void> {
    await this.query(
      `UPDATE zook_bodylog_habit_templates SET
        template_key = $3,
        category = $4,
        names = $5::jsonb,
        icon = $6,
        default_target_count = $7,
        sort_order = $8,
        status = $9,
        updated_at = $10::timestamptz
      WHERE app_id = $1 AND id = $2`,
      [
        record.appId,
        record.id,
        record.templateKey,
        record.category,
        JSON.stringify(record.names),
        record.icon,
        record.defaultTargetCount,
        record.sortOrder,
        record.status,
        record.updatedAt,
      ]
    );
  }

  /**
   * 删除习惯模板
   */
  async deleteBodyLogHabitTemplate(appId: string, id: string): Promise<boolean> {
    const result = await this.query(
      `DELETE FROM zook_bodylog_habit_templates WHERE app_id = $1 AND id = $2`,
      [appId, id]
    );
    return (result.rowCount || 0) > 0;
  }
}
