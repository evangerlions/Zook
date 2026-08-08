export type BodyLogFriendRequestStatus = "pending" | "accepted" | "rejected";

export interface BodyLogFriendRequestRecord {
  id: string;
  appId: string;
  senderUserId: string;
  recipientUserId: string;
  status: BodyLogFriendRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BodyLogFriendshipRecord {
  appId: string;
  userId: string;
  friendUserId: string;
  createdAt: string;
}

export interface BodyLogBlockRecord {
  appId: string;
  blockerUserId: string;
  blockedUserId: string;
  createdAt: string;
}

export const BODYLOG_REPORT_REASONS = [
  "cheating",
  "offensive_profile",
  "harassment",
  "other",
] as const;

export type BodyLogReportReason = (typeof BODYLOG_REPORT_REASONS)[number];

export interface BodyLogReportRecord {
  id: string;
  appId: string;
  reporterUserId: string;
  reportedUserId: string;
  reason: BodyLogReportReason;
  createdAt: string;
}
