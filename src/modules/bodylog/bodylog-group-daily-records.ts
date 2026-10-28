import type { BodyLogGroupStore } from "../../infrastructure/bodylog-store-ports.ts";

import { randomId } from "../../shared/utils.ts";

import type {
  GroupDailyRecordRecord,
} from "./bodylog-group.types.ts";

/**
 * 更新每日记录
 */
export async function updateDailyRecord(store: BodyLogGroupStore, groupId: string, userId: string, date: string): Promise<void> {
  const existingRecord = await store.findGroupDailyRecord(groupId, date);

  const members = await store.listGroupMembers(groupId);
  const activeMembers = members.filter((m) => m.status === "active");

  if (existingRecord) {
    // 更新现有记录
    const activeIds = new Set(activeMembers.map(member => member.userId));
    const completedUserIds = [...new Set([...existingRecord.completedUserIds, userId])].filter(id => activeIds.has(id));

    const updatedRecord: GroupDailyRecordRecord = {
      ...existingRecord,
      totalMembers: activeMembers.length,
      completedUserIds,
      completedCount: completedUserIds.length,
      completionRate: (completedUserIds.length / activeMembers.length) * 100,
    };
    await store.updateGroupDailyRecord(updatedRecord);
  } else {
    // 创建新记录
    const newRecord: GroupDailyRecordRecord = {
      id: randomId("group_daily_record"),
      groupId,
      date,
      completedUserIds: [userId],
      totalMembers: activeMembers.length,
      completedCount: 1,
      completionRate: (1 / activeMembers.length) * 100,
      createdAt: new Date().toISOString(),
    };
    await store.insertGroupDailyRecord(newRecord);
  }
}

/**
 * 成员集合变化后，重算当天每日记录，使 totalMembers / completedUserIds
 * 与当前活跃成员一致（移除/离开成员后不再影响当日完成率与后续结算）。
 */
export async function reconcileTodayDailyRecord(store: BodyLogGroupStore, groupId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const existingRecord = await store.findGroupDailyRecord(groupId, today);
  if (!existingRecord) return;

  const members = await store.listGroupMembers(groupId);
  const activeIds = new Set(members.filter((m) => m.status === "active").map((m) => m.userId));

  const completedUserIds = existingRecord.completedUserIds.filter((id) => activeIds.has(id));
  await store.updateGroupDailyRecord({
    ...existingRecord,
    totalMembers: activeIds.size,
    completedUserIds,
    completedCount: completedUserIds.length,
    completionRate: activeIds.size > 0 ? (completedUserIds.length / activeIds.size) * 100 : 0,
  });
}
