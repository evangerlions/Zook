import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { FrogSleepBuddyNotificationRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

const categories = ["invitations", "interactions", "activities", "goals", "reports"] as const;
type NotificationCategory = typeof categories[number];

export interface BuddyNotificationPreferences {
  enabled: boolean;
  disabledCategories: NotificationCategory[];
  quietStartMinute: number;
  quietEndMinute: number;
  timezoneOffsetMinutes: number;
  cooldownMinutes: number;
  dailyBudget: number;
}

/** Owns buddy notification preferences and interruption-budget decisions. */
export class BuddyNotificationPreferenceService {
  constructor(private readonly database: ApplicationDatabase) {}

  async get(userId: string): Promise<BuddyNotificationPreferences> {
    const record = await this.record(userId);
    return this.normalize(record?.payload ?? {});
  }

  async update(userId: string, input: Record<string, unknown>): Promise<BuddyNotificationPreferences> {
    const current = await this.get(userId);
    const preferences = this.normalize({ ...toPayload(current), ...input }, true);
    const existing = await this.record(userId);
    const now = new Date().toISOString();
    if (existing) {
      await this.database.updateFrogSleepEntity("guardianship_preference", FROGSLEEP_APP_ID, existing.id,
        { payload: toPayload(preferences), updatedAt: now });
    } else {
      await this.database.insertFrogSleepEntity({ id: randomId("buddy_notification_preferences"),
        appId: FROGSLEEP_APP_ID, kind: "guardianship_preference", ownerUserId: userId,
        status: "buddy_notification_preferences", payload: toPayload(preferences), createdAt: now, updatedAt: now });
    }
    return preferences;
  }

  async deliveryDecision(
    userId: string, eventType: string, targetId: string, now = new Date(),
  ): Promise<{ suppressAll?: string; suppressPush?: string }> {
    const preferences = await this.get(userId);
    const category = categoryFor(eventType);
    if (!preferences.enabled || preferences.disabledCategories.includes(category)) {
      return { suppressAll: "PREFERENCE_DISABLED" };
    }
    const history = (await this.database.listFrogSleepBuddyNotifications({
      appId: FROGSLEEP_APP_ID, recipientUserId: userId, limit: 100,
    })).items;
    if (this.isCoalesced(history, eventType, targetId, now)) return { suppressAll: "EVENT_COALESCED" };
    if (this.isQuiet(preferences, now)) return { suppressPush: "QUIET_HOURS" };
    if (this.isCoolingDown(history, category, preferences, now)) return { suppressPush: "CATEGORY_COOLDOWN" };
    if (this.dailyCount(history, preferences, now) >= preferences.dailyBudget) {
      return { suppressPush: "DAILY_BUDGET" };
    }
    return {};
  }

  private async record(userId: string): Promise<FrogSleepEntityRecord | undefined> {
    return (await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference", ownerUserId: userId,
      status: "buddy_notification_preferences", limit: 1 }))[0];
  }

  private normalize(input: Record<string, unknown>, strict = false): BuddyNotificationPreferences {
    const disabled = Array.isArray(input.disabled_categories) ? input.disabled_categories.map(String) : [];
    if (strict && disabled.some((item) => !categories.includes(item as NotificationCategory))) {
      badRequest("REQ_INVALID_BODY", "Invalid buddy notification category.");
    }
    return {
      enabled: typeof input.enabled === "boolean" ? input.enabled : true,
      disabledCategories: disabled.filter((item): item is NotificationCategory => categories.includes(item as NotificationCategory)),
      quietStartMinute: bounded(input.quiet_start_minute, 0, 1439, 1320, strict),
      quietEndMinute: bounded(input.quiet_end_minute, 0, 1439, 420, strict),
      timezoneOffsetMinutes: bounded(input.timezone_offset_minutes, -720, 840, 0, strict),
      cooldownMinutes: bounded(input.cooldown_minutes, 0, 1440, 30, strict),
      dailyBudget: bounded(input.daily_budget, 0, 100, 8, strict),
    };
  }

  private isQuiet(preferences: BuddyNotificationPreferences, now: Date): boolean {
    const shifted = new Date(now.getTime() + preferences.timezoneOffsetMinutes * 60_000);
    const minute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
    const { quietStartMinute: start, quietEndMinute: end } = preferences;
    return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  private isCoalesced(history: FrogSleepBuddyNotificationRecord[], eventType: string, targetId: string, now: Date) {
    return history.some((item) => item.notificationType === eventType && item.targetId === targetId &&
      now.getTime() - new Date(item.createdAt).getTime() < 5 * 60_000);
  }

  private isCoolingDown(
    history: FrogSleepBuddyNotificationRecord[], category: NotificationCategory,
    preferences: BuddyNotificationPreferences, now: Date,
  ) {
    return history.some((item) => categoryFor(item.notificationType) === category &&
      now.getTime() - new Date(item.createdAt).getTime() < preferences.cooldownMinutes * 60_000);
  }

  private dailyCount(history: FrogSleepBuddyNotificationRecord[], preferences: BuddyNotificationPreferences, now: Date) {
    const day = shiftedDay(now, preferences.timezoneOffsetMinutes);
    return history.filter((item) => shiftedDay(new Date(item.createdAt), preferences.timezoneOffsetMinutes) === day).length;
  }
}

function categoryFor(eventType: string): NotificationCategory {
  if (eventType.startsWith("invitation_")) return "invitations";
  if (eventType.includes("goal") || eventType.includes("milestone")) return "goals";
  if (eventType.includes("report")) return "reports";
  if (eventType.includes("activity")) return "activities";
  return "interactions";
}

function bounded(value: unknown, min: number, max: number, fallback: number, strict: boolean): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    if (strict) badRequest("REQ_INVALID_BODY", "Invalid buddy notification preference value.");
    return fallback;
  }
  return parsed;
}

function shiftedDay(date: Date, offsetMinutes: number): string {
  return new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function buddyNotificationPreferencesPayload(value: BuddyNotificationPreferences): Record<string, unknown> {
  return { enabled: value.enabled, disabled_categories: value.disabledCategories,
    quiet_start_minute: value.quietStartMinute, quiet_end_minute: value.quietEndMinute,
    timezone_offset_minutes: value.timezoneOffsetMinutes, cooldown_minutes: value.cooldownMinutes,
    daily_budget: value.dailyBudget };
}

const toPayload = buddyNotificationPreferencesPayload;
