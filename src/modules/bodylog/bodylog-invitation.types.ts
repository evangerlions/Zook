export type BodyLogInvitationIntent = "general" | "buddy" | "group";

export interface BodyLogInvitationRecord {
  id: string;
  appId: string;
  inviterUserId: string;
  inviterInstallIdHash: string;
  tokenHash: string;
  code?: string; // 6 位邀请码（可选）
  intent: BodyLogInvitationIntent;
  expiresAt: string;
  createdAt: string;
}

export interface BodyLogInvitationAttributionRecord {
  id: string;
  appId: string;
  invitationId: string;
  inviterUserId: string;
  inviteeUserId: string;
  installIdHash: string;
  completedDates: string[];
  attributedAt: string;
  qualifiedAt?: string;
  rewardedAt?: string;
  inviterRewardEndsAt?: string;
  inviteeRewardEndsAt?: string;
}
