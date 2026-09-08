import { ApplicationError } from "../../shared/errors.ts";
import type { BodyLogNotificationStore } from "../../infrastructure/bodylog-store-ports.ts";
import type {
  NotificationPreferencesRecord,
  NotificationPreferencesDocument,
  UpdateNotificationPreferencesInput,
  PushDeviceRecord,
  PushDeviceDocument,
  NotificationCategory,
} from "./bodylog-notification.types.ts";
import { VALID_CATEGORIES, DEFAULT_CATEGORIES } from "./bodylog-notification.types.ts";

function toDocument(record: NotificationPreferencesRecord): NotificationPreferencesDocument {
  return {
    userId: record.userId,
    enabledCategories: record.enabledCategories,
    quietHours: {
      isEnabled: record.quietHoursEnabled,
      startHour: record.quietHoursStart,
      endHour: record.quietHoursEnd,
    },
    mergeRequests: record.mergeRequests,
    leaderboardRankPush: record.leaderboardRankPush,
    marketingConsent: record.marketingConsent,
  };
}

function validateCategories(categories: unknown): NotificationCategory[] {
  if (!Array.isArray(categories)) {
    throw new ApplicationError(
      400,
      "BODYLOG_NOTIFICATION_INVALID_CATEGORIES",
      "enabledCategories must be an array",
    );
  }

  const validSet = new Set<string>(VALID_CATEGORIES);
  const result: NotificationCategory[] = [];

  for (const cat of categories) {
    if (typeof cat !== "string" || !validSet.has(cat)) {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_CATEGORY",
        `Invalid category: ${cat}`,
      );
    }
    result.push(cat as NotificationCategory);
  }

  return result;
}

function validateHour(hour: unknown, field: string): number {
  if (typeof hour !== "number" || hour < 0 || hour > 23 || !Number.isInteger(hour)) {
    throw new ApplicationError(
      400,
      "BODYLOG_NOTIFICATION_INVALID_HOUR",
      `${field} must be an integer between 0 and 23`,
    );
  }
  return hour;
}

export class BodyLogNotificationService {
  constructor(private readonly database: BodyLogNotificationStore) {}

  async getPreferences(userId: string): Promise<NotificationPreferencesDocument> {
    const record = await this.database.findBodyLogNotificationPreferences(userId);
    if (!record) {
      // Return defaults if not set
      return {
        userId,
        enabledCategories: [...DEFAULT_CATEGORIES],
        quietHours: {
          isEnabled: false,
          startHour: 22,
          endHour: 7,
        },
        mergeRequests: true,
        leaderboardRankPush: false,
        marketingConsent: false,
      };
    }
    return toDocument(record);
  }

  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesDocument> {
    // Validate enabledCategories if provided
    if (input.enabledCategories !== undefined) {
      input.enabledCategories = validateCategories(input.enabledCategories);
    }

    // Validate quietHours if provided
    if (input.quietHours !== undefined) {
      const qh = input.quietHours;
      if (typeof qh.isEnabled !== "boolean") {
        throw new ApplicationError(
          400,
          "BODYLOG_NOTIFICATION_INVALID_QUIET_HOURS",
          "quietHours.isEnabled must be a boolean",
        );
      }
      validateHour(qh.startHour, "quietHours.startHour");
      validateHour(qh.endHour, "quietHours.endHour");
    }

    // Validate boolean fields
    if (input.mergeRequests !== undefined && typeof input.mergeRequests !== "boolean") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_MERGE_REQUESTS",
        "mergeRequests must be a boolean",
      );
    }
    if (input.leaderboardRankPush !== undefined && typeof input.leaderboardRankPush !== "boolean") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_LEADERBOARD_RANK_PUSH",
        "leaderboardRankPush must be a boolean",
      );
    }
    if (input.marketingConsent !== undefined && typeof input.marketingConsent !== "boolean") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_MARKETING_CONSENT",
        "marketingConsent must be a boolean",
      );
    }

    const record = await this.database.upsertBodyLogNotificationPreferences(userId, input);
    return toDocument(record);
  }

  async registerDevice(
    userId: string,
    deviceToken: string,
    platform: "ios" | "android",
    name?: string,
  ): Promise<PushDeviceDocument> {
    if (!deviceToken || typeof deviceToken !== "string") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_DEVICE_TOKEN",
        "deviceToken is required",
      );
    }

    if (platform !== "ios" && platform !== "android") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_PLATFORM",
        "platform must be 'ios' or 'android'",
      );
    }

    if (name !== undefined && typeof name !== "string") {
      throw new ApplicationError(
        400,
        "BODYLOG_NOTIFICATION_INVALID_DEVICE_NAME",
        "name must be a string when provided",
      );
    }

    const record = await this.database.upsertBodyLogPushDevice(userId, deviceToken, platform, name?.trim() || "Unnamed device");
    return {
      id: record.id,
      platform: record.platform,
      name: record.name,
      lastSeenAt: record.lastSeenAt,
    };
  }

  async listDevices(userId: string): Promise<PushDeviceDocument[]> {
    const records = await this.database.listBodyLogPushDevices(userId);
    return records.map((r) => ({
      id: r.id,
      platform: r.platform,
      name: r.name,
      lastSeenAt: r.lastSeenAt,
    }));
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.database.findBodyLogPushDevice(deviceId);
    if (!device) {
      throw new ApplicationError(
        404,
        "BODYLOG_NOTIFICATION_DEVICE_NOT_FOUND",
        "Device not found",
      );
    }
    if (device.userId !== userId) {
      throw new ApplicationError(
        403,
        "BODYLOG_NOTIFICATION_DEVICE_FORBIDDEN",
        "You do not have permission to remove this device",
      );
    }
    await this.database.deleteBodyLogPushDevice(deviceId);
  }
}
