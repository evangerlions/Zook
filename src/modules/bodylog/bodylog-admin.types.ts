export interface BodyLogHabitTemplateRecord {
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
}

export interface BodyLogCheckinRecordRow {
  recordId: string;
  date: string;
  groupId: string;
  groupName: string;
  userId: string;
  completedCount: number;
  totalMembers: number;
  completionRate: number;
  createdAt: string;
}

export interface BodyLogGroupHealthRow {
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
}

export interface BodyLogGroupMemberContributionRow {
  userId: string;
  nickname: string;
  avatarKey: string | null;
  role: string;
  status: string;
  checkinCount: number;
  lastCheckinAt: string;
}

export interface BodyLogHabitUsageRow {
  habitId: string;
  checkins: number;
  lastCheckinAt: string;
}

export interface BodyLogCheckinDashboardAggregate {
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
}
