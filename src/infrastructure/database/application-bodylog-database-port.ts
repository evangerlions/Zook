import type { BodyLogProfileRecord } from "../../modules/bodylog/bodylog-profile.types.ts";
import type {
  BodyLogBlockRecord,
  BodyLogFriendRequestRecord,
  BodyLogFriendshipRecord,
  BodyLogReportRecord,
} from "../../modules/bodylog/bodylog-social.types.ts";
import type {
  BodyLogDailyAggregate,
  BodyLogLeaderboardEntryRecord,
  BodyLogWeeklyGoalSnapshot,
} from "../../modules/bodylog/bodylog-scoring.types.ts";
import type {
  BodyLogInvitationAttributionRecord,
  BodyLogInvitationRecord,
} from "../../modules/bodylog/bodylog-invitation.types.ts";
import type {
  BodyLogChallengeMemberRecord,
  BodyLogChallengeRecord,
} from "../../modules/bodylog/bodylog-challenge.types.ts";
type MaybePromise<T> = T | Promise<T>;
export interface ApplicationBodyLogDatabasePort {

  findBodyLogProfile(
    appId: string,
    userId: string,
  ): MaybePromise<BodyLogProfileRecord | undefined>;

  listBodyLogProfilesByIds(
    appId: string,
    userIds: string[],
  ): MaybePromise<Map<string, BodyLogProfileRecord>>;

  upsertBodyLogProfile(
    record: BodyLogProfileRecord,
  ): MaybePromise<BodyLogProfileRecord>;

  listBodyLogFriendRequests(appId: string): MaybePromise<BodyLogFriendRequestRecord[]>;

  upsertBodyLogFriendRequest(record: BodyLogFriendRequestRecord): MaybePromise<BodyLogFriendRequestRecord>;

  listBodyLogFriendships(appId: string): MaybePromise<BodyLogFriendshipRecord[]>;

  insertBodyLogFriendship(record: BodyLogFriendshipRecord): MaybePromise<void>;

  deleteBodyLogFriendship(appId: string, userId: string, friendUserId: string): MaybePromise<void>;

  listBodyLogBlocks(appId: string): MaybePromise<BodyLogBlockRecord[]>;

  insertBodyLogBlock(record: BodyLogBlockRecord): MaybePromise<void>;

  deleteBodyLogBlock(appId: string, blockerUserId: string, blockedUserId: string): MaybePromise<void>;

  insertBodyLogReport(record: BodyLogReportRecord): MaybePromise<void>;

  listBodyLogReports(appId: string, reporterUserId: string): MaybePromise<BodyLogReportRecord[]>;

  findBodyLogWeeklyGoalSnapshot(appId: string, userId: string, seasonLabel: string): MaybePromise<BodyLogWeeklyGoalSnapshot | undefined>;

  upsertBodyLogWeeklyGoalSnapshot(record: BodyLogWeeklyGoalSnapshot): MaybePromise<BodyLogWeeklyGoalSnapshot>;

  listBodyLogDailyAggregates(appId: string, userId: string, seasonLabel: string): MaybePromise<BodyLogDailyAggregate[]>;

  upsertBodyLogDailyAggregate(record: BodyLogDailyAggregate): MaybePromise<BodyLogDailyAggregate>;

  findBodyLogLeaderboardEntry(appId: string, userId: string, seasonLabel: string): MaybePromise<BodyLogLeaderboardEntryRecord | undefined>;

  upsertBodyLogLeaderboardEntry(record: BodyLogLeaderboardEntryRecord): MaybePromise<BodyLogLeaderboardEntryRecord>;

  listBodyLogLeaderboardEntries(appId: string, seasonLabel: string): MaybePromise<BodyLogLeaderboardEntryRecord[]>;

  findBodyLogInvitationByTokenHash(appId: string, tokenHash: string): MaybePromise<BodyLogInvitationRecord | undefined>;

  findBodyLogInvitationByCode(appId: string, code: string): MaybePromise<BodyLogInvitationRecord | undefined>;

  updateBodyLogInvitation(record: BodyLogInvitationRecord): MaybePromise<void>;
  insertBodyLogInvitation(record: BodyLogInvitationRecord): MaybePromise<void>;

  listBodyLogInvitations(appId: string, inviterUserId: string): MaybePromise<BodyLogInvitationRecord[]>;

  insertBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): MaybePromise<void>;

  updateBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): MaybePromise<void>;

  listBodyLogInvitationAttributions(appId: string): MaybePromise<BodyLogInvitationAttributionRecord[]>;

  insertBodyLogChallenge(record: BodyLogChallengeRecord): MaybePromise<void>;

  updateBodyLogChallenge(record: BodyLogChallengeRecord): MaybePromise<void>;

  listBodyLogChallenges(appId: string): MaybePromise<BodyLogChallengeRecord[]>;

  insertBodyLogChallengeMembers(records: BodyLogChallengeMemberRecord[]): MaybePromise<void>;

  updateBodyLogChallengeMember(record: BodyLogChallengeMemberRecord): MaybePromise<void>;

  listBodyLogChallengeMembers(appId: string): MaybePromise<BodyLogChallengeMemberRecord[]>;

  // ─── BodyLog 后台打卡管理 ───

  getBodyLogCheckinDashboard(input: {
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

  listBodyLogCheckinUserDates(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): MaybePromise<Array<{ userId: string; date: string }>>;

  searchBodyLogCheckinRecords(input: {
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

  listBodyLogGroupHealth(input: {
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

  listBodyLogGroupMemberContributions(input: {
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

  listBodyLogHabitUsage(input: {
    appId: string;
    fromDate: string;
    toDate: string;
  }): MaybePromise<Array<{
    habitId: string;
    checkins: number;
    lastCheckinAt: string;
  }>>;

  listBodyLogHabitTemplates(appId: string): MaybePromise<Array<{
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

  findBodyLogHabitTemplate(appId: string, id: string): MaybePromise<{
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

  findBodyLogHabitTemplateByKey(appId: string, key: string): MaybePromise<{
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

  insertBodyLogHabitTemplate(record: {
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

  updateBodyLogHabitTemplate(record: {
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

  deleteBodyLogHabitTemplate(appId: string, id: string): MaybePromise<boolean>;
}
