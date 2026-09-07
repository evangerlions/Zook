import { randomBytes } from "node:crypto";
import type { BodyLogBuddyStore, BodyLogSocialAccess } from "../../infrastructure/bodylog-store-ports.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type {
  BuddyPair,
  BuddyPairRecord,
  BuddyActivityRecord,
  BuddyEncouragementRecord,
  CreateBuddyPairRequest,
  EncourageBuddyRequest,
  BuddyFeedResponse,
  BuddyActivity,
  BuddyEncouragement,
} from "./bodylog-buddy.types.ts";
import {
  BUDDY_PAIR_LIMITS,
  BUDDY_RE_INVITATION_COOLDOWN_DAYS,
} from "./bodylog-buddy.types.ts";
import {
  buildBodyLogBuddyNotificationPayload,
  type BodyLogBuddyNotificationType,
} from "./bodylog-buddy-notification.ts";
import { BodyLogBuddySettlement } from "./bodylog-buddy-settlement.ts";
import type { NotificationService } from "../../services/notification.service.ts";
import type { SubscriptionService } from "../../services/subscription.service.ts";

const DAY_MS = 86_400_000;

export class BodyLogBuddyService {
  private readonly settlement: BodyLogBuddySettlement;

  constructor(
    private readonly store: BodyLogBuddyStore,
    private readonly social: BodyLogSocialAccess,
    private readonly notificationService?: NotificationService,
    private readonly subscriptionService?: SubscriptionService,
  ) {
    this.settlement = new BodyLogBuddySettlement(store, notificationService, subscriptionService);
  }

  /**
   * 创建搭子配对邀请
   */
  async createPair(userId: string, req: CreateBuddyPairRequest): Promise<{ pair: BuddyPair; invitationUrl: string }> {
    const { partnerUserId, sharedHabitIds } = req;

    // 验证参数
    if (!partnerUserId || partnerUserId === userId) {
      throw new ApplicationError(400, "BUDDY_INVALID_PARTNER", "Invalid partner user.");
    }
    if (!Array.isArray(sharedHabitIds) || sharedHabitIds.length === 0 || sharedHabitIds.length > 3 || sharedHabitIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(sharedHabitIds).size !== sharedHabitIds.length) {
      throw new ApplicationError(400, "BUDDY_INVALID_HABITS", "Must select 1-3 shared habits.");
    }

    // 检查用户是否已有足够的搭子
    const myBuddies = await this.getMyBuddies(userId);
    const isPremium = await this.checkIsPremium(userId);
    const limit = isPremium ? BUDDY_PAIR_LIMITS.PREMIUM : BUDDY_PAIR_LIMITS.FREE;
    if (myBuddies.length >= limit) {
      throw new ApplicationError(403, "BUDDY_LIMIT_REACHED", `Buddy limit reached (${limit}).`);
    }

    // 检查是否已有配对（双向检查）
    const existingPair = await this.findExistingPair(userId, partnerUserId);
    if (existingPair) {
      if (existingPair.status === "active") {
        throw new ApplicationError(409, "BUDDY_ALREADY_ACTIVE", "Already buddies with this user.");
      }
      if (existingPair.status === "pending" && existingPair.inviterUserId && Date.now() - new Date(existingPair.createdAt).getTime() <= 14 * DAY_MS) {
        throw new ApplicationError(409, "BUDDY_ALREADY_PENDING", "Invitation already sent.");
      }
      // 如果已解除，检查是否在冷却期内
      if (existingPair.status === "dissolved" && existingPair.dissolvedAt) {
        const dissolvedAt = new Date(existingPair.dissolvedAt);
        const now = new Date();
        const daysSinceDissolved = (now.getTime() - dissolvedAt.getTime()) / DAY_MS;
        if (daysSinceDissolved < BUDDY_RE_INVITATION_COOLDOWN_DAYS) {
          throw new ApplicationError(
            403,
            "BUDDY_COOLDOWN_PERIOD",
            `Cannot re-invite within ${BUDDY_RE_INVITATION_COOLDOWN_DAYS} days of dissolution.`,
          );
        }
      }
    }

    // 检查对方是否已被拉黑
    const blocks = await this.social.listBodyLogBlocks(BODYLOG_APP_ID);
    const isBlocked = blocks.some((block) =>
      (block.blockerUserId === userId && block.blockedUserId === partnerUserId) ||
      (block.blockerUserId === partnerUserId && block.blockedUserId === userId)
    );
    if (isBlocked) {
      throw new ApplicationError(403, "BUDDY_BLOCKED", "Cannot invite this user.");
    }

    // 创建配对记录
    const now = new Date();
    const invitationToken = randomBytes(24).toString("base64url");
    const pairId = existingPair?.id ?? randomId("buddy_pair");

    // 确保 userId < partnerUserId（数据库约束）
    const [firstUserId, secondUserId] = userId < partnerUserId
      ? [userId, partnerUserId]
      : [partnerUserId, userId];

    const record: BuddyPairRecord = {
      inviterUserId: userId,
      id: pairId,
      appId: BODYLOG_APP_ID,
      userId: firstUserId,
      partnerUserId: secondUserId,
      sharedHabitIds,
      status: "pending",
      consecutiveDays: 0,
      maxConsecutive: 0,
      currentTier: null,
      lastActiveDate: null,
      revivalUsedThisMonth: 0,
      invitedVia: "friend", // 暂时默认为好友邀请
      invitationToken,
      createdAt: now.toISOString(),
      acceptedAt: null,
      dissolvedAt: null,
      updatedAt: now.toISOString(),
    };

    // 获取对方用户信息
    const partnerProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, partnerUserId);
    if (!partnerProfile) {
      throw new ApplicationError(404, "BUDDY_PARTNER_NOT_FOUND", "Partner user not found.");
    }

    if (existingPair) await this.store.updateBodyLogBuddyPair(record);
    else await this.store.insertBodyLogBuddyPair(record);

    // 发送邀请通知
    await this.sendBuddyNotification(partnerUserId, "buddy_invite", pairId, userId);

    const pair: BuddyPair = {
      id: pairId,
      partnerUserId,
      partnerNickname: partnerProfile.nickname,
      partnerAvatarKey: partnerProfile.avatarKey,
      sharedHabitIds,
      status: "pending",
      consecutiveDays: 0,
      maxConsecutive: 0,
      currentTier: null,
      lastActiveDate: null,
      createdAt: now.toISOString(),
      acceptedAt: null,
    };

    return { pair, invitationUrl: `https://bodylog.app/b/${pairId}?token=${invitationToken}` };
  }

  /**
   * 接受搭子邀请
   */
  async acceptPair(userId: string, pairId: string): Promise<BuddyPair> {
    const pair = await this.store.findBodyLogBuddyPair(pairId);
    if (!pair) {
      throw new ApplicationError(404, "BUDDY_PAIR_NOT_FOUND", "Buddy pair not found.");
    }

    // 验证用户是否是配对中的一方
    if (pair.userId !== userId && pair.partnerUserId !== userId) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "Not authorized to accept this invitation.");
    }

    // 验证状态
    if (pair.status !== "pending") {
      throw new ApplicationError(409, "BUDDY_NOT_PENDING", "Invitation is not pending.");
    }
    if (!pair.inviterUserId || pair.inviterUserId === userId) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "Only the invited user can accept this invitation.");
    }
    for (const participant of [pair.userId, pair.partnerUserId]) {
      const limit = await this.checkIsPremium(participant) ? BUDDY_PAIR_LIMITS.PREMIUM : BUDDY_PAIR_LIMITS.FREE;
      if ((await this.getMyBuddies(participant)).filter(item => item.status === 'active').length >= limit) {
        throw new ApplicationError(403, "BUDDY_LIMIT_REACHED", "Buddy limit reached.");
      }
    }
    const blocks = await this.social.listBodyLogBlocks(BODYLOG_APP_ID);
    if (blocks.some(block => (block.blockerUserId === pair.userId && block.blockedUserId === pair.partnerUserId) || (block.blockerUserId === pair.partnerUserId && block.blockedUserId === pair.userId))) {
      throw new ApplicationError(403, "BUDDY_BLOCKED", "Cannot accept this invitation.");
    }

    // 检查是否过期（14天）
    const createdAt = new Date(pair.createdAt);
    const now = new Date();
    const daysSinceCreated = (now.getTime() - createdAt.getTime()) / DAY_MS;
    if (daysSinceCreated > 14) {
      throw new ApplicationError(410, "BUDDY_INVITATION_EXPIRED", "Invitation has expired.");
    }

    const partnerUserId = pair.userId === userId ? pair.partnerUserId : pair.userId;
    const partnerProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, partnerUserId);
    if (!partnerProfile) {
      throw new ApplicationError(404, "BUDDY_PARTNER_NOT_FOUND", "Partner user not found.");
    }

    // 更新配对状态为active
    const updatedRecord: BuddyPairRecord = {
      ...pair,
      status: "active",
      acceptedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.store.updateBodyLogBuddyPair(updatedRecord);

    // 发送接受通知
    await this.sendBuddyNotification(partnerUserId, "buddy_accepted", pairId, userId);

    const buddyPair: BuddyPair = {
      id: pair.id,
      partnerUserId,
      partnerNickname: partnerProfile.nickname,
      partnerAvatarKey: partnerProfile.avatarKey,
      sharedHabitIds: pair.sharedHabitIds,
      status: "active",
      consecutiveDays: pair.consecutiveDays,
      maxConsecutive: pair.maxConsecutive,
      currentTier: pair.currentTier,
      lastActiveDate: pair.lastActiveDate,
      createdAt: pair.createdAt,
      acceptedAt: now.toISOString(),
    };

    return buddyPair;
  }

  /**
   * 解除搭子关系
   */
  async dissolvePair(userId: string, pairId: string): Promise<void> {
    const pair = await this.store.findBodyLogBuddyPair(pairId);
    if (!pair) {
      throw new ApplicationError(404, "BUDDY_PAIR_NOT_FOUND", "Buddy pair not found.");
    }

    // 验证用户是否是配对中的一方
    if (pair.userId !== userId && pair.partnerUserId !== userId) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "Not authorized to dissolve this pair.");
    }

    // 验证状态
    if (pair.status !== "active") {
      throw new ApplicationError(409, "BUDDY_NOT_ACTIVE", "Buddy pair is not active.");
    }

    const now = new Date();
    const updatedRecord: BuddyPairRecord = {
      ...pair,
      status: "dissolved",
      dissolvedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.store.updateBodyLogBuddyPair(updatedRecord);
  }

  /**
   * 获取用户的搭子列表
   */
  async getMyBuddies(userId: string): Promise<BuddyPair[]> {
    const pairs = await this.store.listBodyLogBuddyPairsByUser(BODYLOG_APP_ID, userId);

    const buddies: BuddyPair[] = [];
    for (const pair of pairs) {
      if (pair.status !== "active" && pair.status !== "pending") continue;
      if (pair.status === "pending" && (!pair.inviterUserId || Date.now() - new Date(pair.createdAt).getTime() > 14 * DAY_MS)) continue;

      const partnerUserId = pair.userId === userId ? pair.partnerUserId : pair.userId;
      const partnerProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, partnerUserId);
      if (!partnerProfile) continue;

      buddies.push({
        id: pair.id,
        partnerUserId,
        partnerNickname: partnerProfile.nickname,
        partnerAvatarKey: partnerProfile.avatarKey,
        sharedHabitIds: pair.sharedHabitIds,
        status: pair.status,
        consecutiveDays: pair.consecutiveDays,
        maxConsecutive: pair.maxConsecutive,
        currentTier: pair.currentTier,
        lastActiveDate: pair.lastActiveDate,
        createdAt: pair.createdAt,
        acceptedAt: pair.acceptedAt,
      });
    }

    return buddies;
  }

  /**
   * 获取搭子详情（包含动态流）
   */
  async getBuddyDetail(userId: string, pairId: string): Promise<BuddyFeedResponse> {
    const pair = await this.store.findBodyLogBuddyPair(pairId);
    if (!pair) {
      throw new ApplicationError(404, "BUDDY_PAIR_NOT_FOUND", "Buddy pair not found.");
    }

    if (pair.userId !== userId && pair.partnerUserId !== userId) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "Not authorized to view this pair.");
    }

    const partnerUserId = pair.userId === userId ? pair.partnerUserId : pair.userId;
    const partnerProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, partnerUserId);
    if (!partnerProfile) {
      throw new ApplicationError(404, "BUDDY_PARTNER_NOT_FOUND", "Partner user not found.");
    }

    const buddyPair: BuddyPair = {
      id: pair.id,
      partnerUserId,
      partnerNickname: partnerProfile.nickname,
      partnerAvatarKey: partnerProfile.avatarKey,
      sharedHabitIds: pair.sharedHabitIds,
      status: pair.status,
      consecutiveDays: pair.consecutiveDays,
      maxConsecutive: pair.maxConsecutive,
      currentTier: pair.currentTier,
      lastActiveDate: pair.lastActiveDate,
      createdAt: pair.createdAt,
      acceptedAt: pair.acceptedAt,
    };

    // 获取动态流
    const activityRecords = await this.store.listBodyLogBuddyActivities(pairId);
    const activities: BuddyActivity[] = await Promise.all(
      activityRecords.map(async (record) => {
        const actorProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, record.actorUserId);
        return {
          id: record.id,
          pairId: record.pairId,
          actorUserId: record.actorUserId,
          actorNickname: actorProfile?.nickname ?? "Unknown",
          actorAvatarKey: actorProfile?.avatarKey ?? "mint_runner",
          type: record.type,
          targetHabitId: record.targetHabitId,
          payload: record.payload,
          createdAt: record.createdAt,
        };
      })
    );

    // 获取鼓励记录
    const encouragementRecords = await this.store.listBodyLogBuddyEncouragements(pairId);
    const encouragements: BuddyEncouragement[] = await Promise.all(
      encouragementRecords.map(async (record) => {
        const fromProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, record.fromUserId);
        return {
          id: record.id,
          pairId: record.pairId,
          fromUserId: record.fromUserId,
          fromNickname: fromProfile?.nickname ?? "Unknown",
          toUserId: record.toUserId,
          emoji: record.emoji,
          isSameAction: record.isSameAction,
          createdAt: record.createdAt,
        };
      })
    );

    return {
      pair: buddyPair,
      activities,
      encouragements,
    };
  }

  /**
   * 记录打卡（广播给搭子）
   */
  async recordCheckin(userId: string, habitId: string, count: number): Promise<void> {
    if (typeof habitId !== 'string' || !habitId.trim() || !Number.isInteger(count) || count < 1) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "A habit and a positive integer count are required.");
    }
    // 查找用户的所有active搭子
    const pairs = await this.store.listBodyLogBuddyPairsByUser(BODYLOG_APP_ID, userId);
    const activePairs = pairs.filter((pair) => pair.status === "active" && pair.sharedHabitIds.includes(habitId));

    if (activePairs.length === 0) return;

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    for (const pair of activePairs) {
      // 创建活动记录
      const activity: BuddyActivityRecord = {
        id: randomId("buddy_activity"),
        pairId: pair.id,
        actorUserId: userId,
        type: "checked_in",
        targetHabitId: habitId,
        payload: { count, date: today },
        createdAt: now.toISOString(),
      };

      await this.store.insertBodyLogBuddyActivity(activity);

      // 发送打卡通知给搭子
      const partnerId = pair.userId === userId ? pair.partnerUserId : pair.userId;
      await this.sendBuddyNotification(partnerId, "buddy_checked_in", pair.id, userId, habitId);

      // 更新最后活跃日期
      const updatedPair: BuddyPairRecord = {
        ...pair,
        lastActiveDate: today,
        updatedAt: now.toISOString(),
      };

      await this.store.updateBodyLogBuddyPair(updatedPair);
    }
  }

  /**
   * 发送鼓励
   */
  async encourage(userId: string, req: EncourageBuddyRequest): Promise<BuddyEncouragement> {
    const { pairId, emoji, isSameAction, targetHabitId } = req;
    if (!["💪", "👏", "🔥", "😊"].includes(emoji)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Unsupported encouragement emoji.");
    }

    const pair = await this.store.findBodyLogBuddyPair(pairId);
    if (!pair) {
      throw new ApplicationError(404, "BUDDY_PAIR_NOT_FOUND", "Buddy pair not found.");
    }

    if (pair.userId !== userId && pair.partnerUserId !== userId) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "Not authorized.");
    }

    if (pair.status !== "active") {
      throw new ApplicationError(409, "BUDDY_NOT_ACTIVE", "Buddy pair is not active.");
    }

    const toUserId = pair.userId === userId ? pair.partnerUserId : pair.userId;
    const now = new Date();

    // 创建鼓励记录
    const encouragement: BuddyEncouragementRecord = {
      id: randomId("buddy_encouragement"),
      pairId,
      fromUserId: userId,
      toUserId,
      emoji,
      isSameAction,
      createdAt: now.toISOString(),
    };

    await this.store.insertBodyLogBuddyEncouragement(encouragement);

    // 发送鼓励通知
    await this.sendBuddyNotification(toUserId, "buddy_encouraged", pairId, userId, targetHabitId);

    // 如果是"同款"鼓励，自动完成打卡
    if (isSameAction && targetHabitId) {
      await this.recordCheckin(userId, targetHabitId, 1);
    }

    // 创建活动记录
    const activity: BuddyActivityRecord = {
      id: randomId("buddy_activity"),
      pairId,
      actorUserId: userId,
      type: "encouraged",
      targetHabitId: targetHabitId ?? null,
      payload: { emoji, isSameAction },
      createdAt: now.toISOString(),
    };

    await this.store.insertBodyLogBuddyActivity(activity);

    const fromProfile = await this.social.findBodyLogProfile(BODYLOG_APP_ID, userId);

    return {
      id: encouragement.id,
      pairId,
      fromUserId: userId,
      fromNickname: fromProfile?.nickname ?? "Unknown",
      toUserId,
      emoji,
      isSameAction,
      createdAt: now.toISOString(),
    };
  }

  async dailySettlement(): Promise<void> {
    await this.settlement.dailySettlement();
  }

  async autoDissolveInactivePairs(): Promise<void> {
    await this.settlement.autoDissolveInactivePairs();
  }

  /**
   * 辅助方法：查找已存在的配对
   */
  private async findExistingPair(userId: string, partnerUserId: string): Promise<BuddyPairRecord | null> {
    const [firstUserId, secondUserId] = userId < partnerUserId
      ? [userId, partnerUserId]
      : [partnerUserId, userId];

    return await this.store.findBodyLogBuddyPairByUsers(BODYLOG_APP_ID, firstUserId, secondUserId);
  }

  /**
   * 辅助方法：检查用户是否为Premium
   */
  private async checkIsPremium(userId: string): Promise<boolean> {
    if (!this.subscriptionService) return false;
    try {
      return await this.subscriptionService.isPremium(BODYLOG_APP_ID, userId);
    } catch {
      return false;
    }
  }

  /**
   * 辅助方法：发送搭子通知
   */
  private async sendBuddyNotification(
    recipientUserId: string,
    type: BodyLogBuddyNotificationType,
    pairId?: string,
    partnerUserId?: string,
    habitId?: string,
    tier?: string,
  ): Promise<void> {
    if (!this.notificationService) return;

    const payload = buildBodyLogBuddyNotificationPayload({
      type,
      pairId,
      partnerUserId,
      habitId,
      tier,
    });

    try {
      await this.notificationService.queueNotification({
        appId: BODYLOG_APP_ID,
        recipientUserId,
        channel: "push",
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch (error) {
      // 通知发送失败不应影响主流程
      console.error("Failed to send buddy notification:", error);
    }
  }
}
