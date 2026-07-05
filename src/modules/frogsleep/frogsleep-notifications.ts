export type FrogSleepNotificationType =
  | "sleep_buddy_invite"
  | "shared_session_invite"
  | "shared_session_interrupted"
  | "shared_session_returned"
  | "morning_summary"
  | "focus_buddy_invite"
  | "focus_achievement";

export interface FrogSleepNotificationPayload {
  app: "frogsleep";
  type: FrogSleepNotificationType;
  entityId?: string;
  relationshipId?: string;
  sessionId?: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export function buildFrogSleepNotificationPayload(input: {
  type: FrogSleepNotificationType;
  entityId?: string;
  relationshipId?: string;
  sessionId?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}): FrogSleepNotificationPayload {
  const copy = defaultCopy(input.type);
  return {
    app: "frogsleep",
    type: input.type,
    entityId: input.entityId,
    relationshipId: input.relationshipId,
    sessionId: input.sessionId,
    title: input.title ?? copy.title,
    body: input.body ?? copy.body,
    data: {
      type: input.type,
      ...(input.entityId ? { entity_id: input.entityId } : {}),
      ...(input.relationshipId ? { relationship_id: input.relationshipId } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      ...(input.data ?? {}),
    },
  };
}

function defaultCopy(type: FrogSleepNotificationType): { title: string; body: string } {
  switch (type) {
    case "sleep_buddy_invite":
      return { title: "新的共同守护邀请", body: "有人邀请你今晚一起共同守护睡眠。" };
    case "shared_session_invite":
      return { title: "今晚的共同守护已发起", body: "对方邀请你一起开始今晚的共同守护。" };
    case "shared_session_interrupted":
      return { title: "对方暂时离开了", body: "对方刚刚离开了共同守护流程。" };
    case "shared_session_returned":
      return { title: "对方回来了", body: "对方已经回到共同守护流程里。" };
    case "morning_summary":
      return { title: "昨晚结果已更新", body: "你们昨晚的共同守护结果已经生成。" };
    case "focus_buddy_invite":
      return { title: "新的专注搭子邀请", body: "有人邀请你成为专注搭子。" };
    case "focus_achievement":
      return { title: "专注成就已达成", body: "你刚刚解锁了新的专注里程碑。" };
  }
}
