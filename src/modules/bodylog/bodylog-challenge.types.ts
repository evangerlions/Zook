export const BODYLOG_CHALLENGE_THEMES = [
  "steady_week",
  "morning_rhythm",
  "movement_breaks",
  "mindful_week",
] as const;

export type BodyLogChallengeTheme = (typeof BODYLOG_CHALLENGE_THEMES)[number];

export interface BodyLogChallengeRecord {
  id: string;
  appId: string;
  creatorUserId: string;
  themeKey: BodyLogChallengeTheme;
  timezone: string;
  status: "pending" | "active" | "cancelled" | "settled";
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BodyLogChallengeMemberRecord {
  appId: string;
  challengeId: string;
  userId: string;
  status: "pending" | "accepted" | "declined";
  completedDates: string[];
  joinedAt?: string;
  updatedAt: string;
}
