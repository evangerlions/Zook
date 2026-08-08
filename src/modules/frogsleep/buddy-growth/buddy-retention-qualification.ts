import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

export type BuddyQualifiedActionType = "interaction" | "joint_action" | "verified_progress" | "goal_completed";

export interface BuddyQualifiedAction {
  id: string;
  relationshipId: string;
  userId?: string;
  type: BuddyQualifiedActionType;
  occurredAt: string;
}

/** Converts server-verified growth records into retention-safe qualifying actions. */
export function qualifyBuddyGrowthRecord(record: FrogSleepEntityRecord): BuddyQualifiedAction | undefined {
  if (!record.relationshipId) return undefined;
  if (record.kind === "buddy_interaction" && record.status === "sent") {
    return action(record, "interaction");
  }
  if (record.kind === "buddy_joint_activity" && ["accepted", "completed"].includes(record.status ?? "")) {
    return action(record, "joint_action");
  }
  if (record.kind === "buddy_goal_contribution" && record.status === "verified") {
    return action(record, "verified_progress");
  }
  if (record.kind === "buddy_joint_goal" && record.status === "completed") {
    return action(record, "goal_completed");
  }
  return undefined;
}

export function weeklyActiveGrowthRelationship(actions: BuddyQualifiedAction[]) {
  return new Set(actions.map((item) => item.id)).size >= 2;
}

function action(record: FrogSleepEntityRecord, type: BuddyQualifiedActionType): BuddyQualifiedAction {
  return { id: record.id, relationshipId: record.relationshipId!, userId: record.ownerUserId,
    type, occurredAt: record.occurredAt ?? record.updatedAt ?? record.createdAt };
}
