type MaybePromise<T> = T | Promise<T>;

/** Administrative BodyLog queries shared by production and test databases. */
export abstract class BodyLogAdminDatabase {
  // ─── BodyLog 后台打卡管理 ───

  abstract getBodyLogCheckinDashboard(input: {
    appId: string;
    fromDate: string;
    toDate: string;
    timezone: string;
  }): MaybePromise<{
    summary: {
      dau: number;
      checkins_today: number;
      active_groups: number;
      total_groups: number;
      total_members: number;
      checkin_rate_daily: number;
      checkin_rate_weekly: number;
      checkin_rate_monthly: number;
    };
    trend: Array<{
      date: string;
      dau: number;
      checkins: number;
      completion_rate: number;
    }>;
    consecutive_distribution: Array<{
      bucket: string;
      users: number;
    }>;
    habit_distribution: Array<{
      habit_id: string;
      checkins: number;
      share: number;
    }>;
  }>;

  abstract listBodyLogCheckinUserDates(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): MaybePromise<Array<{ userId: string; date: string }>>;

  abstract searchBodyLogCheckinRecords(input: {
    appId: string;
    userId?: string;
    groupId?: string;
    fromDate?: string;
    toDate?: string;
    page: number;
    limit: number;
  }): MaybePromise<{
    items: Array<{
      recordId: string;
      date: string;
      groupId: string;
      groupName: string;
      userId: string;
      completedCount: number;
      totalMembers: number;
      completionRate: number;
      createdAt: string;
    }>;
    total: number;
  }>;

  abstract listBodyLogGroupHealth(input: {
    appId: string;
    status?: string;
    health?: "active" | "stale" | "dead";
    fromDate: string;
    toDate: string;
    page: number;
    limit: number;
  }): MaybePromise<{
    items: Array<{
      groupId: string;
      name: string;
      status: string;
      memberCount: number;
      leaderUserId: string;
      createdAt: string;
      lastActiveDate: string;
      checkins7d: number;
      checkins30d: number;
      activeMembers7d: number;
      completionRate7d: number;
    }>;
    total: number;
  }>;

  abstract listBodyLogGroupMemberContributions(input: {
    groupId: string;
    fromDate: string;
    toDate: string;
  }): MaybePromise<Array<{
    userId: string;
    nickname: string;
    avatarKey: string | null;
    role: string;
    status: string;
    checkinCount: number;
    lastCheckinAt: string;
  }>>;

  abstract listBodyLogHabitUsage(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): MaybePromise<Array<{
    habitId: string;
    checkins: number;
    lastCheckinAt: string;
  }>>;

  abstract listBodyLogHabitTemplates(appId: string): MaybePromise<Array<{
    id: string;
    appId: string;
    templateKey: string;
    category: string;
    names: Record<string, string>;
    icon: string | null;
    defaultTargetCount: number;
    sortOrder: number;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  }>>;

  abstract findBodyLogHabitTemplate(appId: string, id: string): MaybePromise<{
    id: string;
    appId: string;
    templateKey: string;
    category: string;
    names: Record<string, string>;
    icon: string | null;
    defaultTargetCount: number;
    sortOrder: number;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  } | undefined>;

  abstract findBodyLogHabitTemplateByKey(appId: string, key: string): MaybePromise<{
    id: string;
    appId: string;
    templateKey: string;
    category: string;
    names: Record<string, string>;
    icon: string | null;
    defaultTargetCount: number;
    sortOrder: number;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  } | undefined>;

  abstract insertBodyLogHabitTemplate(record: {
    id: string;
    appId: string;
    templateKey: string;
    category: string;
    names: Record<string, string>;
    icon: string | null;
    defaultTargetCount: number;
    sortOrder: number;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  }): MaybePromise<void>;

  abstract updateBodyLogHabitTemplate(record: {
    id: string;
    appId: string;
    templateKey: string;
    category: string;
    names: Record<string, string>;
    icon: string | null;
    defaultTargetCount: number;
    sortOrder: number;
    status: "active" | "archived";
    createdAt: string;
    updatedAt: string;
  }): MaybePromise<void>;

  abstract deleteBodyLogHabitTemplate(appId: string, id: string): MaybePromise<boolean>;
}
