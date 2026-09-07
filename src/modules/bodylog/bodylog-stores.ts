import { randomId } from "../../shared/utils.ts";
import type {
  BodyLogBuddyStore,
  BodyLogFeatureFlagStore,
  BodyLogGroupStore,
  BodyLogGrowthStore,
  BodyLogNotificationStore,
  BodyLogSubscriptionStore,
} from "../../infrastructure/bodylog-store-ports.ts";
import type {
  BuddyPairRecord,
  BuddyActivityRecord,
  BuddyEncouragementRecord,
} from "./bodylog-buddy.types.ts";
import type {
  CheckInGroupRecord,
  GroupMemberRecord,
  GroupDailyRecordRecord,
  GroupActivityRecord,
} from "./bodylog-group.types.ts";
import type {
  UserSubscriptionRecord,
  SubscriptionEventRecord,
} from "./bodylog-subscription.types.ts";
import type {
  BodyLogGrowthPlan,
  BodyLogGrowthMission,
  BodyLogGrowthReward,
  CreateGrowthPlanInput,
  CreateGrowthMissionInput,
  CreateGrowthRewardInput,
  UpdateGrowthMissionInput,
  UpdateGrowthPlanInput,
  UpdateGrowthRewardInput,
} from "./bodylog-growth.types.ts";
import type {
  NotificationPreferencesRecord,
  UpdateNotificationPreferencesInput,
  PushDeviceRecord,
} from "./bodylog-notification.types.ts";
import { DEFAULT_CATEGORIES } from "./bodylog-notification.types.ts";
import type { FeatureFlagRecord } from "./bodylog-feature-flag.types.ts";

/**
 * In-memory fallback stores for the BodyLog buddy/group/subscription/growth/
 * notification/feature-flag domains. They mirror the SQL semantics of the
 * postgres store modules (ordering, upsert merges, not-found errors) closely
 * enough for unit tests and local development.
 */

const clone = <T>(value: T): T => structuredClone(value);
const cloneList = <T>(values: T[]): T[] => values.map((value) => structuredClone(value));
const byIsoDesc = (key: (record: any) => string) =>
  (a: any, b: any) => String(key(b) ?? "").localeCompare(String(key(a) ?? ""));

export class InMemoryBodyLogBuddyStore implements BodyLogBuddyStore {
  private readonly pairs: BuddyPairRecord[] = [];
  private readonly activities: BuddyActivityRecord[] = [];
  private readonly encouragements: BuddyEncouragementRecord[] = [];

  insertBodyLogBuddyPair(record: BuddyPairRecord): void { this.pairs.push(clone(record)); }
  findBodyLogBuddyPair(pairId: string): BuddyPairRecord | undefined { return this.pairs.find((r) => r.id === pairId) ? clone(this.pairs.find((r) => r.id === pairId)!) : undefined; }
  updateBodyLogBuddyPair(record: BuddyPairRecord): void {
    const index = this.pairs.findIndex((r) => r.id === record.id);
    if (index >= 0) { this.pairs[index] = clone(record); }
  }
  listBodyLogBuddyPairsByUser(appId: string, userId: string): BuddyPairRecord[] {
    return cloneList(this.pairs.filter((r) => r.appId === appId && (r.userId === userId || r.partnerUserId === userId)).sort(byIsoDesc((r) => r.createdAt)));
  }
  listAllBodyLogBuddyPairs(appId: string): BuddyPairRecord[] {
    return cloneList(this.pairs.filter((r) => r.appId === appId).sort(byIsoDesc((r) => r.createdAt)));
  }
  findBodyLogBuddyPairByUsers(appId: string, userId: string, partnerUserId: string): BuddyPairRecord | undefined {
    const found = this.pairs.find((r) => r.appId === appId && r.userId === userId && r.partnerUserId === partnerUserId);
    return found ? clone(found) : undefined;
  }
  insertBodyLogBuddyActivity(record: BuddyActivityRecord): void { this.activities.push(clone(record)); }
  listBodyLogBuddyActivities(pairId: string): BuddyActivityRecord[] {
    return cloneList(this.activities.filter((r) => r.pairId === pairId).sort(byIsoDesc((r) => r.createdAt)));
  }
  insertBodyLogBuddyEncouragement(record: BuddyEncouragementRecord): void { this.encouragements.push(clone(record)); }
  listBodyLogBuddyEncouragements(pairId: string): BuddyEncouragementRecord[] {
    return cloneList(this.encouragements.filter((r) => r.pairId === pairId).sort(byIsoDesc((r) => r.createdAt)));
  }
}

export class InMemoryBodyLogGroupStore implements BodyLogGroupStore {
  private readonly groups: CheckInGroupRecord[] = [];
  private readonly members: GroupMemberRecord[] = [];
  private readonly dailyRecords: GroupDailyRecordRecord[] = [];
  private readonly activities: GroupActivityRecord[] = [];

  insertCheckInGroup(record: CheckInGroupRecord): void { this.groups.push(clone(record)); }
  findCheckInGroup(groupId: string): CheckInGroupRecord | undefined { return this.cloneGroup(this.groups.find((r) => r.id === groupId)); }
  updateCheckInGroup(record: CheckInGroupRecord): void {
    const index = this.groups.findIndex((r) => r.id === record.id);
    if (index >= 0) { this.groups[index] = clone(record); }
  }
  listCheckInGroupsByUser(appId: string, userId: string): CheckInGroupRecord[] {
    return cloneList(this.groups
      .filter((group) => group.appId === appId && this.members.some((m) => m.groupId === group.id && m.userId === userId && m.status === "active"))
      .sort(byIsoDesc((r) => r.createdAt)));
  }
  listAllCheckInGroups(appId: string): CheckInGroupRecord[] {
    return cloneList(this.groups.filter((r) => r.appId === appId).sort(byIsoDesc((r) => r.createdAt)));
  }
  insertGroupMember(record: GroupMemberRecord): void { this.members.push(clone(record)); }
  findGroupMember(groupId: string, userId: string): GroupMemberRecord | undefined {
    const found = this.members.find((r) => r.groupId === groupId && r.userId === userId);
    return found ? clone(found) : undefined;
  }
  updateGroupMember(record: GroupMemberRecord): void {
    const index = this.members.findIndex((r) => r.id === record.id);
    if (index >= 0) { this.members[index] = clone(record); }
  }
  listGroupMembers(groupId: string): GroupMemberRecord[] {
    return cloneList(this.members.filter((r) => r.groupId === groupId).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)));
  }
  insertGroupDailyRecord(record: GroupDailyRecordRecord): void { this.dailyRecords.push(clone(record)); }
  findGroupDailyRecord(groupId: string, date: string): GroupDailyRecordRecord | undefined {
    const found = this.dailyRecords.find((r) => r.groupId === groupId && r.date === date);
    return found ? clone(found) : undefined;
  }
  updateGroupDailyRecord(record: GroupDailyRecordRecord): void {
    const index = this.dailyRecords.findIndex((r) => r.id === record.id);
    if (index >= 0) { this.dailyRecords[index] = clone(record); }
  }
  listGroupDailyRecordsSince(groupId: string, date: string): GroupDailyRecordRecord[] {
    return cloneList(this.dailyRecords.filter((r) => r.groupId === groupId && r.date >= date).sort(byIsoDesc((r) => r.date)));
  }
  insertGroupActivity(record: GroupActivityRecord): void { this.activities.push(clone(record)); }
  listGroupActivities(groupId: string, limit = 50): GroupActivityRecord[] {
    return cloneList(this.activities.filter((r) => r.groupId === groupId).sort(byIsoDesc((r) => r.createdAt)).slice(0, limit));
  }

  private cloneGroup(record: CheckInGroupRecord | undefined): CheckInGroupRecord | undefined {
    return record ? clone(record) : undefined;
  }
}

export class InMemoryBodyLogSubscriptionStore implements BodyLogSubscriptionStore {
  private readonly subscriptions: UserSubscriptionRecord[] = [];
  private readonly events: SubscriptionEventRecord[] = [];

  findActiveUserSubscription(appId: string, userId: string): UserSubscriptionRecord | null {
    const now = new Date().toISOString();
    const active = this.subscriptions
      .filter((r) => r.appId === appId && r.userId === userId && r.expiresAt > now)
      .sort((a, b) => b.tier.localeCompare(a.tier) || b.expiresAt.localeCompare(a.expiresAt));
    return active[0] ? clone(active[0]) : null;
  }
  upsertUserSubscription(record: UserSubscriptionRecord): void {
    const index = this.subscriptions.findIndex((r) => r.id === record.id);
    if (index >= 0) { this.subscriptions[index] = clone(record); } else { this.subscriptions.push(clone(record)); }
  }
  insertSubscriptionEvent(record: SubscriptionEventRecord): void { this.events.push(clone(record)); }
}

export class InMemoryBodyLogGrowthStore implements BodyLogGrowthStore {
  private readonly plans: BodyLogGrowthPlan[] = [];
  private readonly missions: BodyLogGrowthMission[] = [];
  private readonly rewards: BodyLogGrowthReward[] = [];

  createGrowthPlan(input: CreateGrowthPlanInput): BodyLogGrowthPlan {
    const now = new Date().toISOString();
    const record: BodyLogGrowthPlan = { id: randomId("growth_plan"), createdAt: now, updatedAt: now, ...input };
    this.plans.push(clone(record));
    return record;
  }
  findGrowthPlanById(planId: string): BodyLogGrowthPlan | null { return this.cloneFound(this.plans.find((r) => r.id === planId)); }
  findActiveGrowthPlan(userId: string): BodyLogGrowthPlan | null {
    const active = this.plans.filter((r) => r.userId === userId && r.status === "active").sort(byIsoDesc((r) => r.createdAt));
    return this.cloneFound(active[0]);
  }
  updateGrowthPlan(planId: string, input: UpdateGrowthPlanInput): BodyLogGrowthPlan {
    const existing = this.plans.find((r) => r.id === planId);
    if (!existing) { throw new Error(`Growth plan ${planId} not found`); }
    const updated: BodyLogGrowthPlan = { ...existing, ...clone(input), updatedAt: new Date().toISOString() };
    this.plans[this.plans.indexOf(existing)] = clone(updated);
    return updated;
  }
  incrementGrowthPlanCompletedMissions(planId: string): void {
    const existing = this.plans.find((r) => r.id === planId);
    if (existing) {
      this.plans[this.plans.indexOf(existing)] = { ...existing, completedMissions: existing.completedMissions + 1, updatedAt: new Date().toISOString() };
    }
  }
  createGrowthMission(input: CreateGrowthMissionInput): BodyLogGrowthMission {
    const record: BodyLogGrowthMission = { id: randomId("growth_mission"), completedAt: null, createdAt: new Date().toISOString(), ...input };
    this.missions.push(clone(record));
    return record;
  }
  findGrowthMissionById(missionId: string): BodyLogGrowthMission | null { return this.cloneFound(this.missions.find((r) => r.id === missionId)); }
  findGrowthMissionsByPlanId(planId: string): BodyLogGrowthMission[] {
    return cloneList(this.missions.filter((r) => r.planId === planId).sort((a, b) => a.day - b.day || a.type.localeCompare(b.type)));
  }
  updateGrowthMission(missionId: string, input: UpdateGrowthMissionInput): BodyLogGrowthMission {
    const existing = this.missions.find((r) => r.id === missionId);
    if (!existing) { throw new Error(`Growth mission ${missionId} not found`); }
    const updated: BodyLogGrowthMission = { ...existing, ...clone(input) };
    this.missions[this.missions.indexOf(existing)] = clone(updated);
    return updated;
  }
  completeGrowthMission(missionId: string, completedAt: string): BodyLogGrowthMission | null {
    const existing = this.missions.find((r) => r.id === missionId);
    if (!existing || existing.completed) return null;
    const updated = { ...existing, completed: true, completedAt };
    this.missions[this.missions.indexOf(existing)] = clone(updated);
    this.incrementGrowthPlanCompletedMissions(existing.planId);
    return updated;
  }
  createGrowthReward(input: CreateGrowthRewardInput): BodyLogGrowthReward {
    const record: BodyLogGrowthReward = { id: randomId("growth_reward"), claimedAt: null, createdAt: new Date().toISOString(), ...input };
    this.rewards.push(clone(record));
    return record;
  }
  findGrowthRewardById(rewardId: string): BodyLogGrowthReward | null { return this.cloneFound(this.rewards.find((r) => r.id === rewardId)); }
  findGrowthRewardsByPlanId(planId: string): BodyLogGrowthReward[] {
    return cloneList(this.rewards.filter((r) => r.planId === planId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  updateGrowthReward(rewardId: string, input: UpdateGrowthRewardInput): BodyLogGrowthReward {
    const existing = this.rewards.find((r) => r.id === rewardId);
    if (!existing) { throw new Error(`Growth reward ${rewardId} not found`); }
    const updated: BodyLogGrowthReward = { ...existing, ...clone(input) };
    this.rewards[this.rewards.indexOf(existing)] = clone(updated);
    return updated;
  }
  claimGrowthReward(rewardId: string, claimedAt: string): BodyLogGrowthReward | null {
    const existing = this.rewards.find((r) => r.id === rewardId);
    if (!existing || existing.claimed) return null;
    const updated = { ...existing, claimed: true, claimedAt };
    this.rewards[this.rewards.indexOf(existing)] = clone(updated);
    return updated;
  }

  private cloneFound<T>(found: T | undefined): T | null { return found ? clone(found) : null; }
}

export class InMemoryBodyLogNotificationStore implements BodyLogNotificationStore {
  private readonly preferences = new Map<string, NotificationPreferencesRecord>();
  private readonly devices: PushDeviceRecord[] = [];

  findBodyLogNotificationPreferences(userId: string): NotificationPreferencesRecord | null {
    const preference = this.preferences.get(userId);
    return preference ? clone(preference) : null;
  }
  upsertBodyLogNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): NotificationPreferencesRecord {
    const existing = this.preferences.get(userId);
    const now = new Date().toISOString();
    const record: NotificationPreferencesRecord = {
      id: existing?.id ?? randomId("bodylog_notification_preferences"),
      userId,
      enabledCategories: input.enabledCategories ?? existing?.enabledCategories ?? [...DEFAULT_CATEGORIES],
      quietHoursEnabled: input.quietHours?.isEnabled ?? existing?.quietHoursEnabled ?? false,
      quietHoursStart: input.quietHours?.startHour ?? existing?.quietHoursStart ?? 22,
      quietHoursEnd: input.quietHours?.endHour ?? existing?.quietHoursEnd ?? 7,
      mergeRequests: input.mergeRequests ?? existing?.mergeRequests ?? true,
      leaderboardRankPush: input.leaderboardRankPush ?? existing?.leaderboardRankPush ?? false,
      marketingConsent: input.marketingConsent ?? existing?.marketingConsent ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.preferences.set(userId, clone(record));
    return record;
  }
  upsertBodyLogPushDevice(userId: string, deviceToken: string, platform: "ios" | "android", name: string): PushDeviceRecord {
    const now = new Date().toISOString();
    const existing = this.devices.find((r) => r.deviceToken === deviceToken);
    if (existing) {
      const updated: PushDeviceRecord = { ...existing, userId, platform, name, lastSeenAt: now };
      this.devices[this.devices.indexOf(existing)] = clone(updated);
      return updated;
    }
    const record: PushDeviceRecord = { id: randomId("bodylog_push_device"), userId, deviceToken, platform, name, lastSeenAt: now, createdAt: now };
    this.devices.push(clone(record));
    return record;
  }
  listBodyLogPushDevices(userId: string): PushDeviceRecord[] {
    return cloneList(this.devices.filter((r) => r.userId === userId).sort(byIsoDesc((r) => r.lastSeenAt)));
  }
  findBodyLogPushDevice(deviceId: string): PushDeviceRecord | null {
    const found = this.devices.find((r) => r.id === deviceId);
    return found ? clone(found) : null;
  }
  deleteBodyLogPushDevice(deviceId: string): void {
    const index = this.devices.findIndex((r) => r.id === deviceId);
    if (index >= 0) { this.devices.splice(index, 1); }
  }
}

export class InMemoryBodyLogFeatureFlagStore implements BodyLogFeatureFlagStore {
  private readonly flags: FeatureFlagRecord[] = ['growth', 'friends', 'competition', 'challengeCreation'].map(key => ({
    id: `bodylog_flag_${key}`, key, enabled: false, description: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }));

  listBodyLogFeatureFlags(): FeatureFlagRecord[] {
    return cloneList([...this.flags].sort((a, b) => a.key.localeCompare(b.key)));
  }
  findBodyLogFeatureFlag(key: string): FeatureFlagRecord | null {
    const found = this.flags.find((r) => r.key === key);
    return found ? clone(found) : null;
  }
  updateBodyLogFeatureFlag(key: string, enabled: boolean): FeatureFlagRecord {
    const existing = this.flags.find((r) => r.key === key);
    if (!existing) { throw new Error(`feature flag not found: ${key}`); }
    const updated: FeatureFlagRecord = { ...existing, enabled, updatedAt: new Date().toISOString() };
    this.flags[this.flags.indexOf(existing)] = clone(updated);
    return updated;
  }
}
