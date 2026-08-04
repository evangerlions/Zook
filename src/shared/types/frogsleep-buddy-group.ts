export type FrogSleepBuddyGroupStatus = "forming" | "active" | "paused" | "dissolved";
export type FrogSleepBuddyGroupMemberRole = "owner" | "moderator" | "member";
export type FrogSleepBuddyGroupMemberStatus = "invited" | "active" | "left" | "removed";
export type FrogSleepBuddyGroupInvitationStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

/** Canonical 2-5 person buddy group aggregate. Source of truth for group metadata. */
export interface FrogSleepBuddyGroupRecord {
  id: string;
  appId: string;
  domain: "sleep" | "focus";
  groupName: string;
  groupDescription?: string;
  ownerUserId: string;
  status: FrogSleepBuddyGroupStatus;
  memberCount: number;
  sharingBaseline: string[];
  version: number;
  dissolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Membership in a buddy group. */
export interface FrogSleepBuddyGroupMemberRecord {
  id: string;
  appId: string;
  groupId: string;
  userId: string;
  role: FrogSleepBuddyGroupMemberRole;
  status: FrogSleepBuddyGroupMemberStatus;
  version: number;
  joinedAt?: string;
  leftAt?: string;
  invitedAt?: string;
  inviteExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Invitation to join an existing group. */
export interface FrogSleepBuddyGroupInvitationRecord {
  id: string;
  appId: string;
  groupId: string;
  inviterUserId: string;
  inviteeUserId?: string;
  inviteeEmail?: string;
  status: FrogSleepBuddyGroupInvitationStatus;
  version: number;
  expiresAt: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}
