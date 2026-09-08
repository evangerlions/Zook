export type GroupNotificationType =
  | "group_invite"
  | "group_accepted"
  | "group_checked_in"
  | "group_tier_upgraded"
  | "group_streak_warning"
  | "group_streak_broken"
  | "group_member_joined"
  | "group_member_left";

export interface GroupNotificationPayload {
  app: "bodylog";
  type: GroupNotificationType;
  groupId: string;
  userId?: string;
  habitId?: string;
  tier?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export function buildGroupNotificationPayload(input: {
  type: GroupNotificationType;
  groupId: string;
  userId?: string;
  habitId?: string;
  tier?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}): GroupNotificationPayload {
  const copy = defaultCopy(input.type);
  return {
    app: "bodylog",
    type: input.type,
    groupId: input.groupId,
    userId: input.userId,
    habitId: input.habitId,
    tier: input.tier,
    title: input.title ?? copy.title,
    body: input.body ?? copy.body,
    data: {
      type: input.type,
      group_id: input.groupId,
      ...(input.userId ? { user_id: input.userId } : {}),
      ...(input.habitId ? { habit_id: input.habitId } : {}),
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.data ?? {}),
    },
  };
}

function defaultCopy(type: GroupNotificationType): { title: string; body: string } {
  switch (type) {
    case "group_invite":
      return { title: "新的小组邀请", body: "有人邀请你加入打卡小组。" };
    case "group_accepted":
      return { title: "成员已接受", body: "对方已接受你的小组邀请。" };
    case "group_checked_in":
      return { title: "小组打卡动态", body: "小组有成员完成了打卡，快来看看！" };
    case "group_tier_upgraded":
      return { title: "小组等级提升", body: "恭喜！你们的小组等级提升了！" };
    case "group_streak_warning":
      return { title: "连续打卡即将中断", body: "你们的小组已经连续7天没有全员打卡了，快来保持连续打卡！" };
    case "group_streak_broken":
      return { title: "连续打卡已中断", body: "很遗憾，你们的小组连续打卡记录已中断。" };
    case "group_member_joined":
      return { title: "新成员加入", body: "有新成员加入了你们的小组！" };
    case "group_member_left":
      return { title: "成员离开", body: "有成员离开了你们的小组。" };
  }
}
