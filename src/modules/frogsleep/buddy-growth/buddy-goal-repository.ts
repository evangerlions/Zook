import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

export interface BuddyGoalRepositoryProtocol {
  insertGoal(record: FrogSleepEntityRecord): Promise<FrogSleepEntityRecord>;
  findGoal(id: string): Promise<FrogSleepEntityRecord | undefined>;
  updateGoal(id: string, patch: Partial<FrogSleepEntityRecord>): Promise<FrogSleepEntityRecord | undefined>;
  listGoals(userId: string, relationshipId?: string): Promise<FrogSleepEntityRecord[]>;
  insertContribution(record: FrogSleepEntityRecord): Promise<FrogSleepEntityRecord>;
  findContributionBySource(relationshipId: string, sourceEventId: string): Promise<FrogSleepEntityRecord | undefined>;
  listContributions(relationshipId: string, from: string, to: string): Promise<FrogSleepEntityRecord[]>;
}

/** Persists joint goals and verified contributions through the application database boundary. */
export class BuddyGoalRepository implements BuddyGoalRepositoryProtocol {
  constructor(private readonly database: ApplicationDatabase) {}

  async insertGoal(record: FrogSleepEntityRecord) {
    await this.database.insertFrogSleepEntity(record);
    return record;
  }

  async findGoal(id: string) {
    return await this.database.findFrogSleepEntity("buddy_joint_goal", FROGSLEEP_APP_ID, id);
  }

  async updateGoal(id: string, patch: Partial<FrogSleepEntityRecord>) {
    return await this.database.updateFrogSleepEntity("buddy_joint_goal", FROGSLEEP_APP_ID, id, patch);
  }

  async listGoals(userId: string, relationshipId?: string) {
    const filter = { appId: FROGSLEEP_APP_ID, kind: "buddy_joint_goal" as const, relationshipId, limit: 200 };
    const records = [...await this.database.listFrogSleepEntities({ ...filter, ownerUserId: userId }),
      ...await this.database.listFrogSleepEntities({ ...filter, partnerUserId: userId })];
    return unique(records).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async insertContribution(record: FrogSleepEntityRecord) {
    await this.database.insertFrogSleepEntity(record);
    return record;
  }

  async findContributionBySource(relationshipId: string, sourceEventId: string) {
    const records = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "buddy_goal_contribution", relationshipId, limit: 500 });
    return records.find((item) => item.payload.source_event_id === sourceEventId);
  }

  async listContributions(relationshipId: string, from: string, to: string) {
    const records = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "buddy_goal_contribution", relationshipId, limit: 500 });
    return records.filter((item) => item.createdAt >= from && item.createdAt < to);
  }
}

function unique(records: FrogSleepEntityRecord[]) {
  return [...new Map(records.map((item) => [item.id, item])).values()];
}
