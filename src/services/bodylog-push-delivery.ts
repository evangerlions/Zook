import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { resolveBodyLogStores } from "../application-bodylog-stores.ts";
import { DEFAULT_CATEGORIES, type NotificationCategory } from "../modules/bodylog/bodylog-notification.types.ts";
import type { PushDispatcher, PushNotificationPayload } from "./notification.service.ts";

/** BodyLog devices and preferences must be used instead of the FrogSleep device table. */
export async function deliverBodyLogPush(database: ApplicationDatabase, dispatcher: PushDispatcher, record: {
  recipientUserId: string; payload: Record<string, unknown>;
}): Promise<void> {
  const store = resolveBodyLogStores(database).notification;
  const preferences = await store.findBodyLogNotificationPreferences(record.recipientUserId);
  const type = String(record.payload.type ?? "");
  const category: NotificationCategory = type === "buddy_invite" ? "friendRequest"
    : type.includes("reward") || type === "buddy_tier_upgraded" ? "rewardArrived" : "activity";
  if (!(preferences?.enabledCategories ?? DEFAULT_CATEGORIES).includes(category)) return;
  if (preferences?.quietHoursEnabled) {
    const hour = new Date().getUTCHours();
    const start = preferences.quietHoursStart, end = preferences.quietHoursEnd;
    if (start < end ? hour >= start && hour < end : hour >= start || hour < end) return;
  }
  const devices = await store.listBodyLogPushDevices(record.recipientUserId);
  for (const device of devices) {
    // Re-check ownership in case a token was transferred to a different signed-in account.
    const current = await store.findBodyLogPushDevice(device.id);
    if (!current || current.userId !== record.recipientUserId) continue;
    await dispatcher.dispatch({ appId: "bodylog", userId: record.recipientUserId,
      platform: device.platform, pushToken: device.deviceToken,
      payload: record.payload as unknown as PushNotificationPayload,
      invalidateToken: async () => {
        const latest = await store.findBodyLogPushDevice(device.id);
        if (latest?.userId === record.recipientUserId) await store.deleteBodyLogPushDevice(device.id);
      },
    });
  }
}
