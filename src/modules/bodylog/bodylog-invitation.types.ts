export interface BodyLogInvitationRecord {
  id: string;
  appId: string;
  inviterUserId: string;
  inviterInstallIdHash: string;
  tokenHash: string;
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
