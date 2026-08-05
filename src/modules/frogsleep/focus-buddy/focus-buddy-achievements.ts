import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export async function findFocusMilestone(
  database: ApplicationDatabase,
  userId: string,
  milestoneId: string,
) {
  const records = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_milestone",
    ownerUserId: userId,
    limit: 100,
  });
  return records.find((item) => item.payload.milestone_id === milestoneId);
}

export async function unlockFocusMilestone(
  database: ApplicationDatabase,
  userId: string,
  milestoneId: string,
) {
  const existing = await findFocusMilestone(database, userId, milestoneId);
  if (existing) {
    return existing;
  }
  const createdAt = nowIso();
  const record = {
    id: randomId("focus_milestone"),
    appId: FROGSLEEP_APP_ID,
    kind: "focus_milestone" as const,
    ownerUserId: userId,
    status: "unnotified",
    payload: {
      milestone_id: milestoneId,
      unlocked: true,
      notified: false,
    },
    createdAt,
    updatedAt: createdAt,
  };
  await database.insertFrogSleepEntity(record);
  return record;
}
