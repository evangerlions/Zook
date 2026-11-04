import type { BodyLogGroupStore } from "../../infrastructure/bodylog-store-ports.ts";
import type { NotificationService } from "../../services/notification.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { sendGroupNotification } from "./bodylog-group-notification.ts";
import type { GroupActivityRecord } from "./bodylog-group.types.ts";

/**
 * 转让组长（仅现任 leader 可操作）
 * 原组长降为 admin，新组长保持 active。
 */
export async function transferBodyLogGroupOwnership(
  store: BodyLogGroupStore,
  notificationService: NotificationService | undefined,
  leaderUserId: string,
  groupId: string,
  newLeaderUserId: string,
): Promise<void> {
  const group = await store.findCheckInGroup(groupId);
  if (!group) {
    throw new ApplicationError(404, "GROUP_NOT_FOUND", "Group not found.");
  }
  if (group.status !== "active") {
    throw new ApplicationError(409, "GROUP_NOT_ACTIVE", "Group is not active.");
  }

  if (leaderUserId === newLeaderUserId) {
    throw new ApplicationError(400, "GROUP_INVALID_TARGET", "Already the group leader.");
  }

  const operator = await store.findGroupMember(groupId, leaderUserId);
  if (!operator || operator.status !== "active" || operator.role !== "leader" || group.leaderUserId !== leaderUserId) {
    throw new ApplicationError(403, "GROUP_NOT_AUTHORIZED", "Only the leader can transfer ownership.");
  }

  const target = await store.findGroupMember(groupId, newLeaderUserId);
  if (!target || target.status !== "active") {
    throw new ApplicationError(404, "GROUP_NOT_MEMBER", "Target is not an active member of this group.");
  }

  const now = new Date();
  await store.updateGroupMember({ ...target, role: "leader" });
  await store.updateGroupMember({ ...operator, role: "admin" });
  await store.updateCheckInGroup({
    ...group,
    leaderUserId: newLeaderUserId,
    updatedAt: now.toISOString(),
  });

  const activity: GroupActivityRecord = {
    id: randomId("group_activity"),
    groupId,
    actorUserId: leaderUserId,
    type: "leader_changed",
    targetHabitId: null,
    payload: { newLeaderUserId },
    createdAt: now.toISOString(),
  };
  await store.insertGroupActivity(activity);

  await sendGroupNotification(notificationService, newLeaderUserId, "group_leader_changed", groupId, leaderUserId);
}
