import { createHash } from "node:crypto";
import type { BodyLogBuddyStore, BodyLogSocialAccess } from "../../infrastructure/bodylog-store-ports.ts";
import type { BuddyEncouragement, BuddyEncouragementRecord, BuddyActivityRecord, EncourageBuddyRequest } from "./bodylog-buddy.types.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

interface EncouragementContext {
  store: BodyLogBuddyStore;
  social: BodyLogSocialAccess;
  notify(recipient: string, pairId: string, actor: string, habitId?: string): Promise<void>;
  recordCheckin(userId: string, habitId: string, count: number): Promise<void>;
}

/** Each invocation owns its context; the caller preserves the transaction boundary. */
export async function encourageBodyLogBuddy(context: EncouragementContext, userId: string, req: EncourageBuddyRequest): Promise<BuddyEncouragement> {
    const { pairId, emoji, isSameAction, targetHabitId } = req;
    if (req.operationId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(req.operationId)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "A valid stable operation ID is required.");
    }
    if (!["💪", "👏", "🔥", "😊"].includes(emoji)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Unsupported encouragement emoji.");
    }

    const pair = await context.store.findBodyLogBuddyPair(pairId);
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
    const blocks = await context.social.listBodyLogBlocks(BODYLOG_APP_ID);
    if (blocks.some(item => (item.blockerUserId === userId && item.blockedUserId === toUserId) ||
      (item.blockerUserId === toUserId && item.blockedUserId === userId))) {
      throw new ApplicationError(403, "BUDDY_NOT_AUTHORIZED", "This buddy relationship is unavailable.");
    }
    const encouragementId = req.operationId
      ? "buddy_encouragement_" + createHash("sha256").update(JSON.stringify([pairId, userId, req.operationId])).digest("hex")
      : randomId("buddy_encouragement");
    const activityId = `buddy_activity_${encouragementId}`;
    const prior = req.operationId
      ? (await context.store.listBodyLogBuddyEncouragements(pairId)).find(item => item.id === encouragementId)
      : undefined;
    if (prior) {
      const activity = (await context.store.listBodyLogBuddyActivities(pairId)).find(item => item.id === activityId);
      if (prior.emoji !== emoji || prior.isSameAction !== isSameAction || !activity ||
        activity.targetHabitId !== (targetHabitId ?? null)) {
        throw new ApplicationError(409, "BODYLOG_EVENT_CONFLICT", "Operation ID was used with different content.");
      }
      const profile = await context.social.findBodyLogProfile(BODYLOG_APP_ID, userId);
      return { ...prior, fromNickname: profile?.nickname ?? "Unknown" };
    }
    const now = new Date();

    // 创建鼓励记录
    const encouragement: BuddyEncouragementRecord = {
      id: encouragementId,
      pairId,
      fromUserId: userId,
      toUserId,
      emoji,
      isSameAction,
      createdAt: now.toISOString(),
    };

    await context.store.insertBodyLogBuddyEncouragement(encouragement);

    // 发送鼓励通知
    await context.notify(toUserId, pairId, userId, targetHabitId);

    // 如果是"同款"鼓励，自动完成打卡
    if (isSameAction && targetHabitId) {
      await context.recordCheckin(userId, targetHabitId, 1);
    }

    // 创建活动记录
    const activity: BuddyActivityRecord = {
      id: activityId,
      pairId,
      actorUserId: userId,
      type: "encouraged",
      targetHabitId: targetHabitId ?? null,
      payload: { emoji, isSameAction },
      createdAt: now.toISOString(),
    };

    await context.store.insertBodyLogBuddyActivity(activity);

    const fromProfile = await context.social.findBodyLogProfile(BODYLOG_APP_ID, userId);

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
