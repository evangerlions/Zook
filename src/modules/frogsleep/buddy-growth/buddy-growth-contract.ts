/** Canonical cross-domain vocabulary for the FrogSleep buddy growth product. */
export const buddyInvitationDomains = ["sleep", "focus", "bundle"] as const;
export const buddyInvitationDirections = ["incoming", "outgoing"] as const;
export const buddyInvitationStatuses = ["pending", "accepted", "declined", "cancelled", "expired"] as const;
export const buddyInvitationActions = ["preview", "accept", "decline", "cancel", "share"] as const;
export const buddySharingCategories = ["presence", "daily_summary", "weekly_trend", "shared_activity"] as const;
export const buddyInteractionTypes = ["encouragement", "praise", "support", "join_next_time", "tonight_together", "group_cheer", "group_goodnight"] as const;
export const buddyNotificationTypes = [
  "invitation_received", "invitation_accepted", "invitation_ended", "interaction_received",
  "joint_activity_invited", "goal_updated", "milestone_reached", "weekly_report_ready",
  "group_invitation_received", "group_invitation_accepted", "group_member_joined",
  "group_member_left", "group_goal_updated", "group_weekly_report_ready", "group_dissolved",
] as const;
export const buddyGoalTypes = ["focus_days", "focus_minutes", "sleep_schedule_days", "daily_encouragement",
  "group_focus_days", "group_sleep_days", "group_tonight_together"] as const;
export const buddyReportStates = ["pending", "ready", "redacted", "expired"] as const;
export const buddyGroupStatuses = ["forming", "active", "paused", "dissolved"] as const;
export const buddyGroupMemberRoles = ["owner", "moderator", "member"] as const;
export const buddyGroupMemberStatuses = ["invited", "active", "left", "removed"] as const;
export const buddyGroupInvitationStatuses = ["pending", "accepted", "declined", "cancelled", "expired"] as const;
export const buddyGroupActions = ["pause", "resume", "dissolve", "invite", "remove_member", "change_role", "leave"] as const;

export type BuddyInvitationDomain = typeof buddyInvitationDomains[number];
export type BuddyInvitationDirection = typeof buddyInvitationDirections[number];
export type BuddyInvitationStatus = typeof buddyInvitationStatuses[number];
export type BuddyInvitationAction = typeof buddyInvitationActions[number];
export type BuddySharingCategory = typeof buddySharingCategories[number];
export type BuddyInteractionType = typeof buddyInteractionTypes[number];
export type BuddyNotificationType = typeof buddyNotificationTypes[number];
export type BuddyGoalType = typeof buddyGoalTypes[number];
export type BuddyReportState = typeof buddyReportStates[number];
export type BuddyGroupStatus = typeof buddyGroupStatuses[number];
export type BuddyGroupMemberRole = typeof buddyGroupMemberRoles[number];
export type BuddyGroupMemberStatus = typeof buddyGroupMemberStatuses[number];
export type BuddyGroupInvitationStatus = typeof buddyGroupInvitationStatuses[number];
export type BuddyGroupAction = typeof buddyGroupActions[number];

export function legacyInviteDomain(kind: string): BuddyInvitationDomain | undefined {
  if (kind === "sleep_invite") return "sleep";
  if (kind === "focus_invite") return "focus";
  return undefined;
}
