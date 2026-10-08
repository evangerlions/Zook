import assert from "node:assert/strict";
import test from "node:test";
import { BodyLogBuddySettlement } from "../../src/modules/bodylog/bodylog-buddy-settlement.ts";
import type { BuddyPairRecord } from "../../src/modules/bodylog/bodylog-buddy.types.ts";
import type { BodyLogBuddyStore } from "../../src/infrastructure/bodylog-store-ports.ts";
import type { NotificationService } from "../../src/services/notification.service.ts";

function utcDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function pair(id: string, daysInactive: number): BuddyPairRecord {
  return {
    id, appId: "bodylog", userId: `${id}-a`, partnerUserId: `${id}-b`,
    sharedHabitIds: [], status: "active", consecutiveDays: 4, maxConsecutive: 4,
    currentTier: "silver", lastActiveDate: utcDateDaysAgo(daysInactive),
    revivalUsedThisMonth: 0, invitedVia: null, invitationToken: null,
    createdAt: new Date().toISOString(), acceptedAt: new Date().toISOString(),
    dissolvedAt: null, updatedAt: new Date().toISOString(),
  };
}

test("inactive buddy sweep warns both members at seven days and dissolves at fourteen", async () => {
  const pairs = [pair("warning", 7), pair("dissolve", 14), pair("still-active", 8)];
  const updated: BuddyPairRecord[] = [];
  const notifications: Array<{ recipientUserId: string; payload: Record<string, unknown> }> = [];
  const store = {
    listAllBodyLogBuddyPairs: async () => pairs,
    updateBodyLogBuddyPair: async (record: BuddyPairRecord) => { updated.push(record); },
  } as unknown as BodyLogBuddyStore;
  const notificationService = {
    queueNotification: async (input: { recipientUserId: string; payload: Record<string, unknown> }) => {
      notifications.push(input);
      return { queued: true, notificationJobId: "job" };
    },
  } as unknown as NotificationService;

  const settlement = new BodyLogBuddySettlement(store, notificationService);
  await settlement.autoDissolveInactivePairs();

  assert.deepEqual(notifications.map(({ recipientUserId }) => recipientUserId).sort(), ["warning-a", "warning-b"]);
  assert.ok(notifications.every(({ payload }) => payload.type === "buddy_streak_warning"));
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.id, "dissolve");
  assert.equal(updated[0]?.status, "dissolved");
});

test("inactive buddy sweep continues when warning notifications cannot be queued", async () => {
  let dissolved = false;
  const store = {
    listAllBodyLogBuddyPairs: async () => [pair("dissolve", 14)],
    updateBodyLogBuddyPair: async () => { dissolved = true; },
  } as unknown as BodyLogBuddyStore;
  const notificationService = {
    queueNotification: async () => { throw new Error("queue unavailable"); },
  } as unknown as NotificationService;

  await new BodyLogBuddySettlement(store, notificationService).autoDissolveInactivePairs();
  assert.equal(dissolved, true);
});
