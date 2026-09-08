export type BodyLogBuddyNotificationType =
  | "buddy_invite"
  | "buddy_accepted"
  | "buddy_checked_in"
  | "buddy_encouraged"
  | "buddy_tier_upgraded"
  | "buddy_streak_warning"
  | "buddy_streak_broken"
  | "buddy_revived";

export interface BodyLogBuddyNotificationPayload {
  app: "bodylog";
  type: BodyLogBuddyNotificationType;
  pairId?: string;
  partnerUserId?: string;
  habitId?: string;
  tier?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export function buildBodyLogBuddyNotificationPayload(input: {
  type: BodyLogBuddyNotificationType;
  pairId?: string;
  partnerUserId?: string;
  habitId?: string;
  tier?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}): BodyLogBuddyNotificationPayload {
  const copy = defaultCopy(input.type);
  return {
    app: "bodylog",
    type: input.type,
    pairId: input.pairId,
    partnerUserId: input.partnerUserId,
    habitId: input.habitId,
    tier: input.tier,
    title: input.title ?? copy.title,
    body: input.body ?? copy.body,
    data: {
      type: input.type,
      ...(input.pairId ? { pair_id: input.pairId } : {}),
      ...(input.partnerUserId ? { partner_user_id: input.partnerUserId } : {}),
      ...(input.habitId ? { habit_id: input.habitId } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.data ?? {}),
    },
  };
}

function defaultCopy(type: BodyLogBuddyNotificationType): { title: string; body: string } {
  switch (type) {
    case "buddy_invite":
      return { title: "新的搭子邀请", body: "有人邀请你成为打卡搭子。" };
    case "buddy_accepted":
      return { title: "搭子已接受", body: "对方已接受你的搭子邀请，开始一起打卡吧！" };
    case "buddy_checked_in":
      return { title: "搭子已打卡", body: "你的搭子刚刚完成了打卡，快来看看！" };
    case "buddy_encouraged":
      return { title: "收到搭子鼓励", body: "你的搭子给你发送了鼓励，一起加油！" };
    case "buddy_tier_upgraded":
      return { title: "搭子等级提升", body: "恭喜！你们的搭子等级提升了！" };
    case "buddy_streak_warning":
      return { title: "连续打卡即将中断", body: "你们已经7天没有互动了，快来保持连续打卡！" };
    case "buddy_streak_broken":
      return { title: "连续打卡已中断", body: "很遗憾，你们的连续打卡记录已中断。" };
    case "buddy_revived":
      return { title: "连续打卡已恢复", body: "你们成功恢复了连续打卡记录！" };
  }
}
