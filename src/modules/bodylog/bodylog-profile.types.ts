export const BODYLOG_APP_ID = "bodylog";

export const BODYLOG_AVATAR_KEYS = [
  "mint_runner",
  "blue_drop",
  "orange_sun",
  "purple_moon",
] as const;

export type BodyLogAvatarKey = (typeof BODYLOG_AVATAR_KEYS)[number];

export interface BodyLogProfileRecord {
  appId: string;
  userId: string;
  nickname: string;
  avatarKey: BodyLogAvatarKey;
  profileCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface BodyLogProfileDocument {
  userId: string;
  nickname: string;
  avatarKey: BodyLogAvatarKey;
  profileCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}
