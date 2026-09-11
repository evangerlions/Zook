export type NotificationCategory =
  | "sevenDayPlan"
  | "friendRequest"
  | "challengeInvite"
  | "challengeStartEnd"
  | "rewardArrived"
  | "activity";

export interface NotificationPreferencesRecord {
  id: string;
  userId: string;
  enabledCategories: NotificationCategory[];
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  mergeRequests: boolean;
  leaderboardRankPush: boolean;
  marketingConsent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferencesDocument {
  userId: string;
  enabledCategories: NotificationCategory[];
  quietHours: {
    isEnabled: boolean;
    startHour: number;
    endHour: number;
  };
  mergeRequests: boolean;
  leaderboardRankPush: boolean;
  marketingConsent: boolean;
}

export interface UpdateNotificationPreferencesInput {
  enabledCategories?: NotificationCategory[];
  quietHours?: {
    isEnabled: boolean;
    startHour: number;
    endHour: number;
  };
  mergeRequests?: boolean;
  leaderboardRankPush?: boolean;
  marketingConsent?: boolean;
}

export interface PushDeviceRecord {
  id: string;
  userId: string;
  deviceToken: string;
  platform: "ios" | "android";
  name: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface PushDeviceDocument {
  id: string;
  platform: "ios" | "android";
  name: string;
  lastSeenAt: string;
}

export const VALID_CATEGORIES: readonly NotificationCategory[] = [
  "sevenDayPlan",
  "friendRequest",
  "challengeInvite",
  "challengeStartEnd",
  "rewardArrived",
  "activity",
] as const;

export const DEFAULT_CATEGORIES: readonly NotificationCategory[] = [
  "sevenDayPlan",
  "friendRequest",
  "challengeInvite",
  "rewardArrived",
];
